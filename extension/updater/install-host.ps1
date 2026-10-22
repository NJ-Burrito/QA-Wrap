# Registers the native messaging host com.njburrito.qawrap.updater for the current Windows user (HKCU, no admin). Safe to run twice.
# Run from <extension folder>\updater\ (install.cmd does). The extension folder is the parent of this script's folder: it must be the
# folder you chose in Chrome with Load unpacked, and it must keep this path, so the extension ID never changes.
# No model, no AI service, no account: the only server it ever talks to is GitHub, and only when you press Update.
# مثبّت أداة التحديث التلقائي لـ QA Wrap على Windows. لا يحتاج صلاحيات المسؤول، وآمن إن شغّلته مرتين.
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
function Step($n, $en, $ar) { Write-Host ''; Write-Host "[$n/5] $en"; Write-Host "      $ar" }

Step 1 'Checking this folder.' 'الخطوة 1: نتحقق من المجلد.'
$ext = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$man = Get-Content -LiteralPath (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json
if ($man.name -ne 'QA Wrap' -or -not $man.key) { throw "Run this from the 'updater' folder inside the QA Wrap folder you loaded in Chrome. / شغّله من مجلد updater داخل مجلد QA Wrap." }

Step 2 "Working out QA Wrap's browser ID." 'الخطوة 2: نحسب معرّف QA Wrap في المتصفح.'
# The ID is derived from the manifest key: sha256 of the public key, first 32 hex digits, 0-f mapped to a-p.
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Convert]::FromBase64String($man.key))
$id = -join ($hash[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
Write-Host "      $id"

Step 3 'Copying the updater to your user folder.' 'الخطوة 3: ننسخ أداة التحديث إلى مجلد المستخدم.'
$dest = Join-Path $env:LOCALAPPDATA 'QAWrap\updater'
New-Item -ItemType Directory -Force $dest | Out-Null
foreach ($f in 'host.ps1', 'host.cmd', 'install-host.ps1') { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination $dest -Force }
# Optional access token, only while the repository is private. Asked once, typed hidden, kept in your own user folder.
$cfgPath = Join-Path $dest 'config.json'
$token = ''
if (Test-Path $cfgPath) { try { $token = (Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json).token } catch {} }
if (-not $token -and [Environment]::UserInteractive) {
  Write-Host '      Private preview: paste the access token Nader gave you (nothing shows as you type), or just press Enter to skip.'
  Write-Host '      المعاينة الخاصة: الصق الرمز الذي أعطاك إياه نادر (لن يظهر ما تكتب)، أو اضغط Enter للتخطي.'
  try {
    $sec = Read-Host '      >' -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  } catch { $token = '' }
}
@{ folder = $ext; repo = 'NJ-Burrito/QA-Wrap'; token = "$token" } | ConvertTo-Json | Set-Content -LiteralPath $cfgPath -Encoding UTF8

Step 4 'Telling Chrome and Edge about it.' 'الخطوة 4: نعرّف Chrome وEdge بها.'
$hostName = 'com.njburrito.qawrap.updater'
$json = Join-Path $dest "$hostName.json"
@{ name = $hostName; description = 'QA Wrap updater'; path = (Join-Path $dest 'host.cmd'); type = 'stdio'; allowed_origins = @("chrome-extension://$id/") } |
  ConvertTo-Json | Set-Content -LiteralPath $json -Encoding ASCII
foreach ($k in 'HKCU:\Software\Google\Chrome\NativeMessagingHosts', 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts', 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts', 'HKCU:\Software\Chromium\NativeMessagingHosts') {
  New-Item -Path "$k\$hostName" -Force | Out-Null
  Set-ItemProperty -Path "$k\$hostName" -Name '(default)' -Value $json
}

Step 5 'Done. Nothing else to do: when QA Wrap shows Update, press it.' 'الخطوة 5: تم. لا شيء آخر عليك: عندما تظهر بطاقة التحديث اضغط تحديث.'
Write-Host "      Keep the QA Wrap folder where it is: $ext"
Write-Host '      أبقِ مجلد QA Wrap في مكانه.'
