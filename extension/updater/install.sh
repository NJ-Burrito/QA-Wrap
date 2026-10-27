#!/usr/bin/env bash
# QA Wrap automatic updater, installer for macOS and Linux. Run once:  bash updater/install.sh   (from inside the QA Wrap folder)
# No admin rights. Needs only bash, curl, unzip and sha256sum (or shasum), which macOS and most Linux systems already have.
# Safe to run twice. Registers the native messaging host only for the browsers found on this computer: Chrome (stable, Beta, Dev, Canary), Chromium, Edge,
# Brave, Vivaldi, Opera, Opera GX, Yandex, Arc (Chromium-family) and Firefox (its own manifest), and says which.
# Test hooks: HOME (point it at a fake home), QAW_OS=Darwin|Linux, --dry-run (print the plan, write nothing).
# No model, no AI service, no account: the only server it ever talks to is GitHub, and only when you press Update.
# مثبّت أداة التحديث التلقائي لـ QA Wrap على macOS وLinux. شغّله مرة واحدة. لا يحتاج صلاحيات المسؤول، وآمن إن شغّلته مرتين.
# Never prompts. A token (private fork only): --token <t> or QAW_GITHUB_TOKEN. --quiet prints nothing and exits 0 on success.
set -eu
QUIET=0; TOKEN="${QAW_GITHUB_TOKEN:-}"
DRY=0
while [ $# -gt 0 ]; do case "$1" in --quiet) QUIET=1 ;; --dry-run) DRY=1 ;; --token) shift; TOKEN="${1:-}" ;; esac; shift; done
step() { [ "$QUIET" = 1 ] || [ "$DRY" = 1 ] || printf '\n[%s/5] %s\n      %s\n' "$1" "$2" "$3"; }
die() { printf '\n%s\n%s\n' "$1" "$2" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$(cd "$HERE/.." && pwd)"
HOST=com.njburrito.qawrap.updater

step 1 "Checking this folder." "الخطوة 1: نتحقق من المجلد."
[ -f "$EXT/manifest.json" ] && grep -q '"name": *"QA Wrap"' "$EXT/manifest.json" || die "Run this from the 'updater' folder inside the QA Wrap folder you loaded in Chrome." "شغّله من مجلد updater داخل مجلد QA Wrap الذي حمّلته في Chrome."
for t in curl unzip; do command -v "$t" >/dev/null 2>&1 || die "Missing tool: $t (install it with your system's package manager)." "أداة ناقصة: $t"; done
KEY=$(sed -n 's/.*"key" *: *"\([^"]*\)".*/\1/p' "$EXT/manifest.json" | head -n1)
GECKO=$(sed -n 's/.*"id" *: *"\([^"]*\)".*/\1/p' "$EXT/manifest.json" | head -n1) # a Firefox build has this instead of a key\n[ -n "$KEY" ] || [ -n "$GECKO" ] || die "manifest.json has no key or add-on id." "ملف manifest.json بلا مفتاح أو معرّف إضافة."

step 2 "Working out QA Wrap's browser ID." "الخطوة 2: نحسب معرّف QA Wrap في المتصفح."
ID=""
if [ -n "$KEY" ]; then
  H=$(printf '%s' "$KEY" | { base64 -d 2>/dev/null || base64 -D; } | { sha256sum 2>/dev/null || shasum -a 256; })
  ID=$(printf '%s' "$H" | cut -c1-32 | tr '0-9a-f' 'a-p')
fi
[ "$QUIET" = 1 ] || [ "$DRY" = 1 ] || printf '      %s%s\n' "$ID" "$GECKO"

# Per-user native messaging folders: Chrome docs (~/.config/google-chrome, ~/Library/Application Support/Google/Chrome), Edge docs, Mozilla "Native manifests" (Firefox).
# Beta/Dev/Canary, Brave, Vivaldi, Opera, Yandex and Arc follow the Chromium rule "<user data dir>/NativeMessagingHosts"; only browsers whose folder exists are touched.
OSN="${QAW_OS:-$(uname -s)}"
case "$OSN" in
  Darwin) B="$HOME/Library/Application Support"; FFDIR="$B/Mozilla"; FFSEEN="$B/Firefox"
    DIRS="Google/Chrome|Google/Chrome Beta|Google/Chrome Dev|Google/Chrome Canary|Chromium|Microsoft Edge|Microsoft Edge Beta|Microsoft Edge Dev|Microsoft Edge Canary|BraveSoftware/Brave-Browser|BraveSoftware/Brave-Browser-Beta|BraveSoftware/Brave-Browser-Nightly|Vivaldi|com.operasoftware.Opera|com.operasoftware.OperaGX|Yandex/YandexBrowser|Arc/User Data" ;;
  *) B="$HOME/.config"; FFDIR="$HOME/.mozilla"; FFSEEN="$HOME/.mozilla"
    DIRS="google-chrome|google-chrome-beta|google-chrome-unstable|chromium|microsoft-edge|microsoft-edge-beta|microsoft-edge-dev|BraveSoftware/Brave-Browser|BraveSoftware/Brave-Browser-Beta|BraveSoftware/Brave-Browser-Nightly|vivaldi|vivaldi-snapshot|opera|yandex-browser" ;;
esac
FOUND=""; DONE=0
if [ -n "$ID" ]; then
  OLDIFS=$IFS; IFS='|'
  for d in $DIRS; do
    IFS=$OLDIFS
    if [ -d "$B/$d" ]; then FOUND="${FOUND:+$FOUND, }$d"; DONE=$((DONE + 1)); [ "$DRY" = 1 ] && printf 'plan: %s -> %s/NativeMessagingHosts\n' "$d" "$B/$d"; fi
    IFS='|'
  done
  IFS=$OLDIFS
fi
FF=0
if [ -n "$GECKO" ] && [ -d "$FFSEEN" ]; then
  FF=1; DONE=$((DONE + 1)); FOUND="${FOUND:+$FOUND, }Firefox"
  if [ "$OSN" = Darwin ]; then FFMAN="$FFDIR/NativeMessagingHosts"; else FFMAN="$FFDIR/native-messaging-hosts"; fi
  [ "$DRY" = 1 ] && printf 'plan: Firefox -> %s\n' "$FFMAN"
fi
[ "$DRY" = 1 ] && exit 0

step 3 "Copying the updater to your user folder." "الخطوة 3: ننسخ أداة التحديث إلى مجلد المستخدم."
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/qawrap/updater"
mkdir -p "$DEST"
cp "$HERE/host.sh" "$DEST/host.sh"
chmod 755 "$DEST/host.sh"
# an earlier saved token is kept when none is given; never asked
if [ -z "$TOKEN" ] && [ -f "$DEST/config.env" ]; then TOKEN=$(sed -n 's/^TOKEN="\(.*\)"$/\1/p' "$DEST/config.env"); fi
umask 077
# config.env is read by host.sh as plain KEY="value" lines (never sourced); a quote, backslash or newline in a value would break that, so refuse it.
case "$EXT$TOKEN" in *'"'*|*\*|*$'\n'*) echo "The folder or token contains a quote, backslash or newline; not supported." >&2; exit 1 ;; esac
printf 'FOLDER="%s"\nREPO="NJ-Burrito/QA-Wrap"\nTOKEN="%s"\n' "$EXT" "$TOKEN" > "$DEST/config.env"
chmod 600 "$DEST/config.env"

step 4 "Telling your browsers about it." "الخطوة 4: نعرّف المتصفحات بها."
[ "$DONE" -gt 0 ] || die "No supported browser folder was found (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Yandex, Arc or Firefox). Open the browser once, then run this again." "لم نجد متصفحًا مدعومًا. افتح المتصفح مرة ثم أعد التشغيل."
if [ -n "$ID" ]; then
  OLDIFS=$IFS; IFS='|'
  for d in $DIRS; do
    IFS=$OLDIFS
    if [ -d "$B/$d" ]; then
      mkdir -p "$B/$d/NativeMessagingHosts"
      printf '{\n  "name": "%s",\n  "description": "QA Wrap updater",\n  "path": "%s",\n  "type": "stdio",\n  "allowed_origins": ["chrome-extension://%s/"]\n}\n' "$HOST" "$DEST/host.sh" "$ID" > "$B/$d/NativeMessagingHosts/$HOST.json"
    fi
    IFS='|'
  done
  IFS=$OLDIFS
fi
if [ "$FF" = 1 ]; then # Firefox reads allowed_extensions (the gecko id), not allowed_origins
  mkdir -p "$FFMAN"
  printf '{\n  "name": "%s",\n  "description": "QA Wrap updater",\n  "path": "%s",\n  "type": "stdio",\n  "allowed_extensions": ["%s"]\n}\n' "$HOST" "$DEST/host.sh" "$GECKO" > "$FFMAN/$HOST.json"
fi
step 5 "Done." "الخطوة 5: تم. لا شيء آخر عليك: عندما تظهر بطاقة التحديث اضغط تحديث."
[ "$QUIET" = 1 ] || printf '      Registered for: %s\n      تم التسجيل في: %s\n' "$FOUND" "$FOUND"
[ "$QUIET" = 1 ] || printf '      Keep the QA Wrap folder where it is: %s\n      أبقِ مجلد QA Wrap في مكانه.\n' "$EXT"
exit 0
