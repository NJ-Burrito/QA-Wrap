# QA Wrap native messaging host: com.njburrito.qawrap.updater (Chrome starts it; no admin rights).
# One request {op:'update', version, zip, zipApi, sha256, token} -> download, verify, swap the extension folder in place, answer {ok}.
# The folder comes from config.json written by install.cmd, never from the message. Rolls back from the backup on any failure.
# Nothing outside the extension folder is touched: the browser profile (storage, IndexedDB, sessions, settings) lives elsewhere.
# Test hooks (never used by Chrome): -ConfigPath <file> -MessageFile <json file> run one request without stdin/stdout framing.
param([string]$ConfigPath = (Join-Path $PSScriptRoot 'config.json'), [string]$MessageFile = "")
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$UA = @{ 'User-Agent' = 'qa-wrap-updater' }

function Read-Message {
  $in = [Console]::OpenStandardInput()
  $len = New-Object byte[] 4
  if ($in.Read($len, 0, 4) -ne 4) { throw 'no message' }
  $buf = New-Object byte[] ([BitConverter]::ToInt32($len, 0))
  $got = 0
  while ($got -lt $buf.Length) { $n = $in.Read($buf, $got, $buf.Length - $got); if ($n -le 0) { throw 'short message' }; $got += $n }
  [Text.Encoding]::UTF8.GetString($buf)
}
function Write-Message($obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $out = [Console]::OpenStandardOutput()
  $out.Write([BitConverter]::GetBytes([int]$bytes.Length), 0, 4)
  $out.Write($bytes, 0, $bytes.Length)
  $out.Flush()
}
function Stage($name) { if (-not $MessageFile) { Write-Message @{ stage = $name } } } # progress for the update page; the final answer still comes last
function Clear-Folder($dir) { Get-ChildItem -LiteralPath $dir -Force | Remove-Item -Recurse -Force }
function Fill-Folder($from, $dir) { Get-ChildItem -LiteralPath $from -Force | Copy-Item -Destination $dir -Recurse -Force }

# First hop with HttpWebRequest (Windows PowerShell 5.1 cannot read a 302 from Invoke-WebRequest -MaximumRedirection 0): the token goes to this URL only, the signed redirect target is fetched without it.
function Get-Asset($url, $h, $out) {
  $r = [Net.HttpWebRequest]::Create($url)
  $r.AllowAutoRedirect = $false; $r.UserAgent = $UA['User-Agent']; $r.Accept = $h.Accept; $r.Headers.Add('Authorization', $h.Authorization)
  try { $resp = $r.GetResponse() } catch [Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw } }
  try {
    $code = [int]$resp.StatusCode
    if ($code -ge 300 -and $code -lt 400) {
      $loc = $resp.Headers['Location']; if (-not $loc) { throw "download failed ($code, no Location)" }
      Invoke-WebRequest ([Uri]::new($r.RequestUri, $loc)).AbsoluteUri -Headers $UA -OutFile $out
    } elseif ($code -eq 200) {
      $fs = [IO.File]::Create($out); try { $resp.GetResponseStream().CopyTo($fs) } finally { $fs.Dispose() }
    } else { throw "download failed ($code)" }
  } finally { $resp.Close() }
}
function Invoke-Update($cfg, $m) {
  $folder = $cfg.folder.TrimEnd('\')
  $repo = if ($cfg.repo) { $cfg.repo } else { 'NJ-Burrito/QA-Wrap' }
  if ($m.version -notmatch '^\d+\.\d+\.\d+$') { throw 'bad version' }
  $installed = Get-Content -LiteralPath (Join-Path $folder 'manifest.json') -Raw | ConvertFrom-Json
  $work = Join-Path ([IO.Path]::GetTempPath()) ('qaw-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory $work | Out-Null
  $zip = Join-Path $work 'release.zip'
  try {
    Stage 'downloading'
    if ($m.localZip -and $MessageFile) { Copy-Item $m.localZip $zip } # test hook only
    else {
      $h = $UA.Clone()
      $tok = if ($m.token) { $m.token } else { $cfg.token }
      if ($tok -and $m.zipApi -and ($m.zipApi -match "^https://api\.github\.com/repos/$([regex]::Escape($repo))/releases/assets/\d+$" -or ($MessageFile -and $m.zipApi -match '^http://127\.0\.0\.1:\d+/'))) {
        $h.Authorization = "Bearer $tok"; $h.Accept = 'application/octet-stream'
        Get-Asset $m.zipApi $h $zip
      } elseif ($m.zip -match "^https://github\.com/$([regex]::Escape($repo))/releases/download/") {
        Invoke-WebRequest $m.zip -Headers $UA -OutFile $zip
      } else { throw 'the download address is not this repository' }
    }
    Stage 'checking'
    if ($m.sha256 -and ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne "$($m.sha256)".ToLower())) { throw 'checksum mismatch' }
    $new = Join-Path $work 'new'
    Expand-Archive -LiteralPath $zip -DestinationPath $new -Force
    $root = [IO.Path]::GetFullPath($new) + '\'
    foreach ($f in Get-ChildItem $new -Recurse -Force) { if (-not ([IO.Path]::GetFullPath($f.FullName) + '\').StartsWith($root)) { throw 'unsafe path in zip' } }
    $nm = Join-Path $new 'manifest.json'
    if (-not (Test-Path $nm)) { throw 'no manifest.json at the top of the zip' }
    $nman = Get-Content -LiteralPath $nm -Raw | ConvertFrom-Json
    if ($nman.name -ne $installed.name -or $nman.key -ne $installed.key) { throw 'not the same extension (name or key differs)' }
    if ($nman.version -ne $m.version) { throw "zip is $($nman.version), expected $($m.version)" }
    if ([version]$nman.version -le [version]$installed.version) { throw 'not newer than the installed version' }

    Stage 'installing'
    $backup = "$folder.backup-$($installed.version)"
    Get-ChildItem -LiteralPath (Split-Path $folder) -Directory -Filter ((Split-Path $folder -Leaf) + '.backup-*') | Remove-Item -Recurse -Force # keep only the newest backup
    Copy-Item -LiteralPath $folder -Destination $backup -Recurse
    try {
      Clear-Folder $folder
      Fill-Folder $new $folder
      if ((Get-Content -LiteralPath (Join-Path $folder 'manifest.json') -Raw | ConvertFrom-Json).version -ne $m.version) { throw 'swap check failed' }
    } catch {
      $why = $_.Exception.Message
      try { Clear-Folder $folder } catch {}
      Fill-Folder $backup $folder # rollback
      throw "swap failed, rolled back: $why"
    }
    try { foreach ($f in 'host.ps1', 'host.cmd', 'install-host.ps1') { Copy-Item -LiteralPath (Join-Path $folder "updater\$f") -Destination $PSScriptRoot -Force } } catch {} # the host updates itself too (best effort)
    @{ ok = $true; from = $installed.version; to = $m.version; backup = $backup }
  } finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}

try {
  $cfg = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  $raw = if ($MessageFile) { Get-Content -LiteralPath $MessageFile -Raw } else { Read-Message }
  $m = $raw | ConvertFrom-Json
  if ($m.op -eq 'ping') { $res = @{ ok = $true; ping = $true } }
  elseif ($m.op -ne 'update') { throw 'unknown op' }
  else { $res = Invoke-Update $cfg $m }
} catch { $res = @{ ok = $false; error = "$($_.Exception.Message)" } }
if ($MessageFile) { $res | ConvertTo-Json -Compress } else { Write-Message $res }
