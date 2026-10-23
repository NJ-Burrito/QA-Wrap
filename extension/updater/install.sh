#!/usr/bin/env bash
# QA Wrap automatic updater, installer for macOS and Linux. Run once:  bash updater/install.sh   (from inside the QA Wrap folder)
# No admin rights. Needs only bash, curl, unzip and sha256sum (or shasum), which macOS and most Linux systems already have.
# Safe to run twice. Registers the native messaging host for Chrome, Chromium, Edge and Brave (only the ones that exist on this computer).
# No model, no AI service, no account: the only server it ever talks to is GitHub, and only when you press Update.
# مثبّت أداة التحديث التلقائي لـ QA Wrap على macOS وLinux. شغّله مرة واحدة. لا يحتاج صلاحيات المسؤول، وآمن إن شغّلته مرتين.
# Never prompts. A token (private fork only): --token <t> or QAW_GITHUB_TOKEN. --quiet prints nothing and exits 0 on success.
set -eu
QUIET=0; TOKEN="${QAW_GITHUB_TOKEN:-}"
while [ $# -gt 0 ]; do case "$1" in --quiet) QUIET=1 ;; --token) shift; TOKEN="${1:-}" ;; esac; shift; done
step() { [ "$QUIET" = 1 ] || printf '\n[%s/5] %s\n      %s\n' "$1" "$2" "$3"; }
die() { printf '\n%s\n%s\n' "$1" "$2" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$(cd "$HERE/.." && pwd)"
HOST=com.njburrito.qawrap.updater

step 1 "Checking this folder." "الخطوة 1: نتحقق من المجلد."
[ -f "$EXT/manifest.json" ] && grep -q '"name": *"QA Wrap"' "$EXT/manifest.json" || die "Run this from the 'updater' folder inside the QA Wrap folder you loaded in Chrome." "شغّله من مجلد updater داخل مجلد QA Wrap الذي حمّلته في Chrome."
for t in curl unzip; do command -v "$t" >/dev/null 2>&1 || die "Missing tool: $t (install it with your system's package manager)." "أداة ناقصة: $t"; done
KEY=$(sed -n 's/.*"key" *: *"\([^"]*\)".*/\1/p' "$EXT/manifest.json" | head -n1)
[ -n "$KEY" ] || die "manifest.json has no key." "ملف manifest.json بلا مفتاح."

step 2 "Working out QA Wrap's browser ID." "الخطوة 2: نحسب معرّف QA Wrap في المتصفح."
H=$(printf '%s' "$KEY" | { base64 -d 2>/dev/null || base64 -D; } | { sha256sum 2>/dev/null || shasum -a 256; })
ID=$(printf '%s' "$H" | cut -c1-32 | tr '0-9a-f' 'a-p')
[ "$QUIET" = 1 ] || printf '      %s\n' "$ID"

step 3 "Copying the updater to your user folder." "الخطوة 3: ننسخ أداة التحديث إلى مجلد المستخدم."
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/qawrap/updater"
mkdir -p "$DEST"
cp "$HERE/host.sh" "$DEST/host.sh"
chmod 755 "$DEST/host.sh"
# an earlier saved token is kept when none is given; never asked
if [ -z "$TOKEN" ] && [ -f "$DEST/config.env" ]; then TOKEN=$(sed -n 's/^TOKEN="\(.*\)"$/\1/p' "$DEST/config.env"); fi
umask 077
printf 'FOLDER="%s"\nREPO="NJ-Burrito/QA-Wrap"\nTOKEN="%s"\n' "$EXT" "$TOKEN" > "$DEST/config.env"
chmod 600 "$DEST/config.env"

step 4 "Telling your browsers about it." "الخطوة 4: نعرّف المتصفحات بها."
case "$(uname -s)" in
  Darwin) B="$HOME/Library/Application Support"; DIRS="Google/Chrome|Chromium|Microsoft Edge|BraveSoftware/Brave-Browser" ;;
  *) B="$HOME/.config"; DIRS="google-chrome|chromium|microsoft-edge|BraveSoftware/Brave-Browser" ;;
esac
DONE=0
OLDIFS=$IFS; IFS='|'
for d in $DIRS; do
  IFS=$OLDIFS
  if [ -d "$B/$d" ]; then
    mkdir -p "$B/$d/NativeMessagingHosts"
    printf '{\n  "name": "%s",\n  "description": "QA Wrap updater",\n  "path": "%s",\n  "type": "stdio",\n  "allowed_origins": ["chrome-extension://%s/"]\n}\n' "$HOST" "$DEST/host.sh" "$ID" > "$B/$d/NativeMessagingHosts/$HOST.json"
    [ "$QUIET" = 1 ] || printf '      ok: %s\n' "$d"; DONE=$((DONE + 1))
  fi
  IFS='|'
done
IFS=$OLDIFS
[ "$DONE" -gt 0 ] || die "No Chrome, Chromium, Edge or Brave profile folder was found. Open the browser once, then run this again." "لم نجد Chrome أو Chromium أو Edge أو Brave. افتح المتصفح مرة ثم أعد التشغيل."

step 5 "Done." "الخطوة 5: تم. لا شيء آخر عليك: عندما تظهر بطاقة التحديث اضغط تحديث."
[ "$QUIET" = 1 ] || printf '      Keep the QA Wrap folder where it is: %s\n      أبقِ مجلد QA Wrap في مكانه.\n' "$EXT"
exit 0
