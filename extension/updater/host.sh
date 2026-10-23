#!/usr/bin/env bash
# QA Wrap native messaging host (macOS and Linux): com.njburrito.qawrap.updater. Needs only bash, curl, unzip, sed, od, dd, and sha256sum or shasum.
# One request {"op":"update","version","zip","zipApi","sha256","token"} -> download, check SHA-256, swap the extension folder in place, answer {"ok":...}.
# The folder comes from config.env written by install.sh, never from the message. Rolls back from the backup on any failure.
# The browser profile (storage, sessions, settings) lives elsewhere and is never touched. No model, no AI service, no other server than GitHub.
# Test hooks (never used by the browser): QAW_CONFIG=<file> QAW_MESSAGE_FILE=<file> QAW_LOCAL_ZIP=<zip>.
set -u
CONFIG="${QAW_CONFIG:-$(cd "$(dirname "$0")" && pwd)/config.env}"
FOLDER=""; REPO="NJ-Burrito/QA-Wrap"; TOKEN=""
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"

reply() { # reply <json>: 4-byte little-endian length, then the JSON
  local out="$1" n; n=${#out}
  if [ -n "${QAW_MESSAGE_FILE:-}" ]; then printf '%s\n' "$out"; return; fi
  printf "$(printf '\\x%02x\\x%02x\\x00\\x00' $((n & 255)) $((n >> 8)))"
  printf '%s' "$out"
}
fail() { reply "{\"ok\":false,\"error\":\"$(printf '%s' "$1" | tr -d '"\\' | cut -c1-180)\"}"; exit 0; }
field() { printf '%s' "$MSG" | sed -n 's/.*"'"$1"'":"\([^"]*\)".*/\1/p'; }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
jfield() { sed -n 's/.*"'"$1"'" *: *"\([^"]*\)".*/\1/p' "$2" | head -n1; }

if [ -n "${QAW_MESSAGE_FILE:-}" ]; then MSG=$(cat "$QAW_MESSAGE_FILE")
else
  len=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' ')
  [ -n "$len" ] && [ "$len" -gt 0 ] && [ "$len" -lt 65536 ] || fail "no message"
  MSG=$(dd bs=1 count="$len" 2>/dev/null)
fi

[ "$(field op)" = "ping" ] && { reply '{"ok":true,"ping":true}'; exit 0; }
[ "$(field op)" = "update" ] || fail "unknown op"
VERSION=$(field version); ZIP=$(field zip); ZIPAPI=$(field zipApi); SUM=$(field sha256); MTOKEN=$(field token)
[ -n "$MTOKEN" ] && TOKEN="$MTOKEN"
printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "bad version"
[ -n "$FOLDER" ] && [ -f "$FOLDER/manifest.json" ] || fail "extension folder not found"
FOLDER="${FOLDER%/}"

WORK=$(mktemp -d) || fail "no temp folder"
trap 'rm -rf "$WORK"' EXIT
ZIPF="$WORK/release.zip"
if [ -n "${QAW_LOCAL_ZIP:-}" ]; then cp "$QAW_LOCAL_ZIP" "$ZIPF"
elif [ -n "$TOKEN" ] && printf '%s' "$ZIPAPI" | grep -Eq "^https://api\.github\.com/repos/$REPO/releases/assets/[0-9]+\$"; then
  # the token goes to api.github.com only: first hop without -L, then the signed redirect target is fetched without the header
  curl -fsS -D "$WORK/hdr" -o "$ZIPF" -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" -A qa-wrap-updater "$ZIPAPI" || fail "download failed"
  LOC=$(tr -d '\r' < "$WORK/hdr" | sed -n 's/^[Ll]ocation: *//p' | tail -n1)
  if [ -n "$LOC" ]; then curl -fsSL -A qa-wrap-updater -o "$ZIPF" "$LOC" || fail "download failed"; fi
elif printf '%s' "$ZIP" | grep -Eq "^https://github\.com/$REPO/releases/download/"; then
  curl -fsSL -A qa-wrap-updater -o "$ZIPF" "$ZIP" || fail "download failed"
else fail "the download address is not this repository"; fi

[ -z "$SUM" ] || [ "$(sha "$ZIPF")" = "$SUM" ] || fail "checksum mismatch"
mkdir "$WORK/new" && unzip -q "$ZIPF" -d "$WORK/new" || fail "could not unzip"
if find "$WORK/new" | grep -q '\.\./'; then fail "unsafe path in zip"; fi
NM="$WORK/new/manifest.json"
[ -f "$NM" ] || fail "no manifest.json at the top of the zip"
# same extension AND same build family: Chromium builds carry "key", Gecko builds carry the gecko "id" instead
for f in key name id; do [ "$(jfield $f "$NM")" = "$(jfield $f "$FOLDER/manifest.json")" ] || fail "not the same extension"; done
[ "$(jfield version "$NM")" = "$VERSION" ] || fail "zip is $(jfield version "$NM"), expected $VERSION"
OLD=$(jfield version "$FOLDER/manifest.json")
[ "$(printf '%s\n%s\n' "$OLD" "$VERSION" | sort -V | tail -n1)" = "$VERSION" ] && [ "$OLD" != "$VERSION" ] || fail "not newer than the installed version"

BACKUP="$FOLDER.backup-$OLD"
rm -rf "$FOLDER".backup-* # keep only the newest backup
cp -R "$FOLDER" "$BACKUP" || fail "could not make the backup"
clear_folder() { find "$FOLDER" -mindepth 1 -maxdepth 1 -exec rm -rf {} +; }
if clear_folder && cp -R "$WORK/new/." "$FOLDER/" && [ "$(jfield version "$FOLDER/manifest.json")" = "$VERSION" ]; then
  reply "{\"ok\":true,\"from\":\"$OLD\",\"to\":\"$VERSION\"}"
  exit 0 # a bash script must not be overwritten while it runs: run install.sh again to refresh the host itself
else
  clear_folder; cp -R "$BACKUP/." "$FOLDER/"
  fail "swap failed, rolled back"
fi
