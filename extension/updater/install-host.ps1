# Registers the native messaging host com.njburrito.qawrap.updater for the current Windows user (HKCU, no admin). Safe to run twice.
# Run from <extension folder>\updater\ (install.cmd does). The extension folder is the parent of this script's folder: it must be the
# folder you chose in Chrome with Load unpacked, and it must keep this path, so the extension ID never changes.
# No model, no AI service, no account: the only server it ever talks to is GitHub, and only when you press Update.
# مثبّت أداة التحديث التلقائي لـ QA Wrap على Windows. لا يحتاج صلاحيات المسؤول، وآمن إن شغّلته مرتين.
# Never prompts: a token (only for a private fork) comes from -Token or QAW_GITHUB_TOKEN. -Quiet prints nothing and exits 0 on success.
# Test hooks: -RegRoot (default HKCU:\Software) and -DestDir (default %LOCALAPPDATA%\QAWrap\updater) point the writes elsewhere.
param([string]$Token = $env:QAW_GITHUB_TOKEN, [switch]$Quiet, [string]$RegRoot = 'HKCU:\Software', [string]$DestDir = '')
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
function Step($n, $en, $ar) { if ($Quiet) { return }; Write-Host ''; Write-Host "[$n/5] $en"; Write-Host "      $ar" }
function Say($t) { if (-not $Quiet) { Write-Host $t } }

Step 1 'Checking this folder.' 'الخطوة 1: نتحقق من المجلد.'
$ext = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$man = Get-Content -LiteralPath (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
if ($man.name -ne 'QA Wrap' -or -not $man.key) { throw "Run this from the 'updater' folder inside the QA Wrap folder you loaded in Chrome. / شغّله من مجلد updater داخل مجلد QA Wrap." }

Step 2 "Working out QA Wrap's browser ID." 'الخطوة 2: نحسب معرّف QA Wrap في المتصفح.'
# The ID is derived from the manifest key: sha256 of the public key, first 32 hex digits, 0-f mapped to a-p.
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($man.key))
$id = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
Say "      $id"

Step 3 'Copying the updater to your user folder.' 'الخطوة 3: ننسخ أداة التحديث إلى مجلد المستخدم.'
$dest = if ($DestDir) { $DestDir } else { Join-Path $env:LOCALAPPDATA 'QAWrap\updater' }
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in 'host.ps1', 'host.cmd', 'install-host.ps1') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $dest -Force }
# Optional access token, only for a private fork: -Token or QAW_GITHUB_TOKEN; an earlier saved one is kept. Never asked.
$cfgPath = Join-Path $dest 'config.json'
if (-not $Token -and (Test-Path $cfgPath)) { try { $Token = (Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json).token } catch {} }
$token = "$Token"
@{ folder = $ext; repo = 'NJ-Burrito/QA-Wrap'; token = "$token" } | ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8

Step 4 'Telling Chrome and Edge about it.' 'الخطوة 4: نعرّف Chrome وEdge بها.'
$hostName = 'com.njburrito.qawrap.updater'
$json = Join-Path $dest "$hostName.json"
@{ name = $hostName; description = 'QA Wrap updater'; path = (Join-Path $dest 'host.cmd'); type = 'stdio'; allowed_origins = @("chrome-extension://$id/") } |
  ConvertTo-Json | Set-Content -LiteralPath $json -Encoding ASCII
foreach ($b in 'Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Chromium') {
  $k = "$RegRoot\$b\NativeMessagingHosts"
  New-Item -Path "$k\$hostName" -Force | Out-Null
  Set-ItemProperty -Path "$k\$hostName" -Name '(default)' -Value $json
}

Step 5 'Done. Nothing else to do: when QA Wrap shows Update, press it.' 'الخطوة 5: تم. لا شيء آخر عليك: عندما تظهر بطاقة التحديث اضغط تحديث.'
Say "      Keep the QA Wrap folder where it is: $ext"
Say '      أبقِ مجلد QA Wrap في مكانه.'
exit 0
