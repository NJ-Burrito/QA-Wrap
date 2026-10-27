#!/usr/bin/env bash
# QA Wrap native messaging host (macOS and Linux): com.njburrito.qawrap.updater. Needs only bash, curl, unzip, sed, od, dd, and sha256sum or shasum.
# One request {"op":"update","version","zip","zipApi","sha256","token"} -> download, check SHA-256, swap the extension folder in place, answer {"ok":...}.
# The folder comes from config.env written by install.sh, never from the message. Rolls back from the backup on any failure.
# The browser profile (storage, sessions, settings) lives elsewhere and is never touched. No model, no AI service, no other server than GitHub.
# Test hooks (never used by the browser): QAW_CONFIG=<file> QAW_MESSAGE_FILE=<file> QAW_LOCAL_ZIP=<zip>.
set -u
CONFIG="${QAW_CONFIG:-$(cd "$(dirname "$0")" && pwd)/config.env}"
FOLDER=""; REPO="NJ-Burrito/QA-Wrap"; TOKEN=""
# config.env is read as plain KEY="value" lines and never sourced, so nothing in it can run as shell code.
cfgval() { sed -n 's/^'"$1"'="\(.*\)"[[:space:]]*$/\1/p' "$CONFIG" 2>/dev/null | head -n1; }
if [ -f "$CONFIG" ]; then
  v=$(cfgval FOLDER); [ -n "$v" ] && FOLDER="$v"
  v=$(cfgval REPO); [ -n "$v" ] && REPO="$v"
  v=$(cfgval TOKEN); [ -n "$v" ] && TOKEN="$v"
fi

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

# The download address is compared as a whole, never by prefix: exactly https://github.com/<repo>/releases/download/<tag>/<file> with plain characters only.
# No %-escape, query, userinfo, port, backslash or "." / ".." segment can pass, so .../download/../../../evil/repo/... is refused (curl would resolve it to another repository).
release_url_ok() { # <url> <required suffix, may be empty>
  case "$1" in *$'\n'*) return 1 ;; esac
  printf '%s' "$1" | grep -Eq '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[A-Za-z0-9_.+-]+/[A-Za-z0-9_.+-]+$' || return 1
  case "/${1#https://}/" in */./*|*/../*) return 1 ;; esac
  case "$1" in *"$2") ;; *) return 1 ;; esac
  case "$1" in "https://github.com/$REPO/releases/download/"*) return 0 ;; esac
  return 1
}
# A redirect may only go to this repository's release URL or to GitHub's own asset CDN (*.githubusercontent.com).
redirect_ok() {
  release_url_ok "$1" "" && return 0
  printf '%s' "$1" | grep -Eq '^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.githubusercontent\.com/[^[:space:]]*$'
}
fetch_public() { # <url> <out>: no token, redirects followed by hand (at most 5), each hop checked; returns 2 for a bad redirect
  local url="$1" out="$2" hop code loc
  for hop in 1 2 3 4 5; do
    code=$(curl -sS --proto '=https' -o "$out" -D "$WORK/h$hop" -w '%{http_code}' -A qa-wrap-updater "$url") || return 1
    case "$code" in
      200) return 0 ;;
      301|302|303|307|308)
        loc=$(tr -d '\r' < "$WORK/h$hop" | sed -n 's/^[Ll]ocation: *//p' | tail -n1)
        case "$loc" in /*) loc="https://github.com$loc" ;; esac
        redirect_ok "$loc" || return 2
        url="$loc" ;;
      *) return 1 ;;
    esac
  done
  return 1
}

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
printf '%s' "$REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || fail "bad repository in the config"
[ -n "$FOLDER" ] && [ -f "$FOLDER/manifest.json" ] || fail "extension folder not found"
FOLDER="${FOLDER%/}"

WORK=$(mktemp -d) || fail "no temp folder"
trap 'rm -rf "$WORK"' EXIT
ZIPF="$WORK/release.zip"
WANT=""; NEEDSIDE=0
if [ -n "$SUM" ]; then printf '%s' "$SUM" | grep -Eq '^[0-9a-fA-F]{64}$' || fail "bad checksum in the update message"; WANT=$(printf '%s' "$SUM" | tr 'A-F' 'a-f'); fi
if [ -n "${QAW_LOCAL_ZIP:-}" ]; then cp "$QAW_LOCAL_ZIP" "$ZIPF"
elif [ -n "$TOKEN" ] && printf '%s' "$ZIPAPI" | grep -Eq "^https://api\.github\.com/repos/$REPO/releases/assets/[0-9]+\$"; then
  # the token goes to api.github.com only: first hop without -L, then the redirect target (checked) is fetched without the header
  curl -fsS --proto '=https' -D "$WORK/hdr" -o "$ZIPF" -H "Authorization: Bearer $TOKEN" -H "Accept: application/octet-stream" -A qa-wrap-updater "$ZIPAPI" || fail "download failed"
  LOC=$(tr -d '\r' < "$WORK/hdr" | sed -n 's/^[Ll]ocation: *//p' | tail -n1)
  if [ -n "$LOC" ]; then
    redirect_ok "$LOC" || fail "the download was redirected away from this repository"
    fetch_public "$LOC" "$ZIPF" || fail "download failed"
  fi
elif release_url_ok "$ZIP" ".zip"; then
  fetch_public "$ZIP" "$ZIPF"; rc=$?
  [ "$rc" = 2 ] && fail "the download was redirected away from this repository"
  [ "$rc" = 0 ] || fail "download failed"
  NEEDSIDE=1
else fail "the download address is not this repository"; fi

if [ "$NEEDSIDE" = 1 ]; then # the .sha256 file published beside the zip in the same release
  release_url_ok "$ZIP.sha256" ".zip.sha256" || fail "the checksum address is not this repository"
  fetch_public "$ZIP.sha256" "$WORK/side" || fail "could not download the release checksum"
  LINE=$(head -n1 "$WORK/side" | tr -d '\r'); H=${LINE%% *}; F=${LINE#"$H"}; F=${F# }; F=${F# }; F=${F#\*}
  printf '%s' "$H" | grep -Eq '^[0-9a-fA-F]{64}$' || fail "the release checksum file is not a SHA-256 line"
  { [ -z "$F" ] || [ "$F" = "${ZIP##*/}" ]; } || fail "the release checksum file is for another file"
  WANT="$WANT $(printf '%s' "$H" | tr 'A-F' 'a-f')"
fi
[ -n "${WANT# }" ] || fail "no checksum for this download: refusing to install"
HAVE=$(sha "$ZIPF")
for w in $WANT; do [ "$HAVE" = "$w" ] || fail "checksum mismatch"; done
# refuse an unsafe entry name before anything is extracted
if unzip -Z1 "$ZIPF" | grep -Eq '(^|/)\.\.(/|$)|^/|\|^[A-Za-z]:'; then fail "unsafe path in zip"; fi
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
