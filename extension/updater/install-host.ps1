# Registers the native messaging host com.njburrito.qawrap.updater for the current Windows user (HKCU, no admin). Safe to run twice.
# Run from <extension folder>\updater\ (install.cmd does). The extension folder is the parent of this script's folder: it must be the
# folder you chose in Chrome with Load unpacked, and it must keep this path, so the extension ID never changes.
# No model, no AI service, no account: the only server it ever talks to is GitHub, and only when you press Update.
# مثبّت أداة التحديث التلقائي لـ QA Wrap على Windows. لا يحتاج صلاحيات المسؤول، وآمن إن شغّلته مرتين.
# Never prompts: a token (only for a private fork) comes from -Token or QAW_GITHUB_TOKEN. -Quiet prints nothing and exits 0 on success.
# Registers only the browsers found on this computer (Chrome stable/Beta/Dev/Canary, Chromium, Edge x4, Brave x3, Vivaldi, Opera, Opera GX, Yandex, Arc) and Firefox, and says which.
# Test hooks: -RegRoot (default HKCU:\Software), -DestDir (default %LOCALAPPDATA%\QAWrap\updater), -Roots (a;-separated list of folders searched for browsers instead of LOCALAPPDATA and Program Files) and -DryRun (print the plan, write nothing).
param([string]$Token = $env:QAW_GITHUB_TOKEN, [switch]$Quiet, [string]$RegRoot = 'HKCU:\Software', [string]$DestDir = '', [string[]]$Roots = @(), [switch]$DryRun)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
function Step($n, $en, $ar) { if ($Quiet -or $DryRun) { return }; Write-Host ''; Write-Host "[$n/5] $en"; Write-Host "      $ar" }
function Say($t) { if (-not $Quiet) { Write-Host $t } }
function Plan($t) { if ($DryRun) { Write-Host $t } }

Step 1 'Checking this folder.' 'الخطوة 1: نتحقق من المجلد.'
$ext = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$man = Get-Content -LiteralPath (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
$gecko = "$($man.browser_specific_settings.gecko.id)"
if ($man.name -ne 'QA Wrap' -or (-not $man.key -and -not $gecko)) { throw "Run this from the 'updater' folder inside the QA Wrap folder you loaded in Chrome. / شغّله من مجلد updater داخل مجلد QA Wrap." }

Step 2 "Working out QA Wrap's browser ID." 'الخطوة 2: نحسب معرّف QA Wrap في المتصفح.'
# Chromium builds carry the signing key: the ID is sha256 of the public key, first 32 hex digits, 0-f mapped to a-p. A Firefox build has no key, only its gecko id.
$id = ''
if ($man.key) {
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($man.key))
  $id = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
}
Say "      $id$gecko"

# Browsers by their per-user native messaging key under HKCU\Software (Chrome docs, Edge docs, KeePassXC for Brave/Vivaldi; Opera, Yandex and Arc are unconfirmed, so they get both the Google\Chrome and the Chromium key).
$roots = if ($Roots.Count) { @($Roots | ForEach-Object { $_ -split ';' }) } else { @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:APPDATA) | Where-Object { $_ } }
$GC = 'Google\Chrome'; $CM = 'Chromium'
$browsers = @(
  @{ n = 'Google Chrome';        d = @('Google\Chrome');                      k = @($GC) },
  @{ n = 'Google Chrome Beta';   d = @('Google\Chrome Beta');                 k = @($GC) },
  @{ n = 'Google Chrome Dev';    d = @('Google\Chrome Dev');                  k = @($GC) },
  @{ n = 'Google Chrome Canary'; d = @('Google\Chrome SxS');                  k = @($GC) },
  @{ n = 'Chromium';             d = @('Chromium');                           k = @($CM) },
  @{ n = 'Microsoft Edge';       d = @('Microsoft\Edge');                     k = @('Microsoft\Edge') },
  @{ n = 'Microsoft Edge Beta';  d = @('Microsoft\Edge Beta');                k = @('Microsoft\Edge') },
  @{ n = 'Microsoft Edge Dev';   d = @('Microsoft\Edge Dev');                 k = @('Microsoft\Edge') },
  @{ n = 'Microsoft Edge Canary';d = @('Microsoft\Edge SxS');                 k = @('Microsoft\Edge') },
  @{ n = 'Brave';                d = @('BraveSoftware\Brave-Browser');        k = @('BraveSoftware\Brave-Browser', $GC) },
  @{ n = 'Brave Beta';           d = @('BraveSoftware\Brave-Browser-Beta');   k = @('BraveSoftware\Brave-Browser', $GC) },
  @{ n = 'Brave Nightly';        d = @('BraveSoftware\Brave-Browser-Nightly');k = @('BraveSoftware\Brave-Browser', $GC) },
  @{ n = 'Vivaldi';              d = @('Vivaldi');                            k = @($GC) },
  @{ n = 'Opera';                d = @('Programs\Opera', 'Opera Software\Opera Stable', 'Opera'); k = @($GC, $CM) },
  @{ n = 'Opera GX';             d = @('Programs\Opera GX', 'Opera Software\Opera GX Stable', 'Opera GX'); k = @($GC, $CM) },
  @{ n = 'Yandex Browser';       d = @('Yandex\YandexBrowser');               k = @($GC, $CM) },
  @{ n = 'Arc';                  d = @('Packages\TheBrowserCompany.Arc_*', 'Arc'); k = @($GC, $CM) }
)
$found = @()
foreach ($b in $browsers) {
  $hit = $false
  foreach ($r in $roots) { foreach ($d in $b.d) { if (Test-Path -Path (Join-Path $r $d)) { $hit = $true } } }
  if ($hit) { $found += $b }
}
$ffFound = $false
foreach ($r in $roots) { if ((Test-Path (Join-Path $r 'Mozilla Firefox')) -or (Test-Path (Join-Path $r 'Mozilla\Firefox'))) { $ffFound = $true } }
if ($id -and -not $found.Count) { # nothing recognised (a portable copy, say): the four classic keys, as before
  $found = @(@{ n = 'Chrome, Edge, Brave, Chromium (none found; default set)'; k = @($GC, 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', $CM) })
}
$names = @(); $keys = @()
if ($id) { foreach ($b in $found) { $names += $b.n; $keys += $b.k } }
if ($gecko -and $ffFound) { $names += 'Firefox' }
$keys = @($keys | Select-Object -Unique)
foreach ($b in $found) { if ($id) { Plan "plan: $($b.n) -> $($b.k -join ', ')" } }
if ($gecko -and $ffFound) { Plan "plan: Firefox -> Mozilla (allowed_extensions $gecko)" }
if ($DryRun) { exit 0 }

Step 3 'Copying the updater to your user folder.' 'الخطوة 3: ننسخ أداة التحديث إلى مجلد المستخدم.'
$dest = if ($DestDir) { $DestDir } else { Join-Path $env:LOCALAPPDATA 'QAWrap\updater' }
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in 'host.ps1', 'host.cmd', 'install-host.ps1') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $dest -Force }
# Optional access token, only for a private fork: -Token or QAW_GITHUB_TOKEN; an earlier saved one is kept. Never asked.
$cfgPath = Join-Path $dest 'config.json'
if (-not $Token -and (Test-Path $cfgPath)) { try { $Token = (Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json).token } catch {} }
$token = "$Token"
@{ folder = $ext; repo = 'NJ-Burrito/QA-Wrap'; token = "$token" } | ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8
if ($token) { try { & icacls.exe $cfgPath /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null } catch {} } # the token is readable by this user only

Step 4 'Telling your browsers about it.' 'الخطوة 4: نعرّف المتصفحات بها.'
$hostName = 'com.njburrito.qawrap.updater'
$hostCmd = Join-Path $dest 'host.cmd'
function Reg($key, $json) {
  $k = "$RegRoot\$key\NativeMessagingHosts\$hostName"
  New-Item -Path $k -Force | Out-Null
  Set-ItemProperty -Path $k -Name '(default)' -Value $json
}
if ($id) {
  $json = Join-Path $dest "$hostName.json"
  @{ name = $hostName; description = 'QA Wrap updater'; path = $hostCmd; type = 'stdio'; allowed_origins = @("chrome-extension://$id/") } | ConvertTo-Json | Set-Content -LiteralPath $json -Encoding ASCII
  foreach ($key in $keys) { Reg $key $json }
}
if ($gecko -and $ffFound) { # Firefox reads allowed_extensions (the gecko id), not allowed_origins
  $fjson = Join-Path $dest "$hostName.firefox.json"
  @{ name = $hostName; description = 'QA Wrap updater'; path = $hostCmd; type = 'stdio'; allowed_extensions = @($gecko) } | ConvertTo-Json | Set-Content -LiteralPath $fjson -Encoding ASCII
  Reg 'Mozilla' $fjson
}

Step 5 'Done. Nothing else to do: when QA Wrap shows Update, press it.' 'الخطوة 5: تم. لا شيء آخر عليك: عندما تظهر بطاقة التحديث اضغط تحديث.'
Say "      Registered for: $($names -join ', ')"
Say "      تم التسجيل في: $($names -join '، ')"
Say "      Keep the QA Wrap folder where it is: $ext"
Say '      أبقِ مجلد QA Wrap في مكانه.'
exit 0