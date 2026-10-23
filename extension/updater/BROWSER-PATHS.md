# Where the updater registers its native messaging host, per browser

Used by `install-host.ps1` (Windows) and `install.sh` (Mac, Linux). Host name `com.njburrito.qawrap.updater`. [V] = read in the source named, [U] = not confirmed there (registered on the safe side, or by analogy with Chromium's `<user data dir>/NativeMessagingHosts` rule).

## Sources

- Chrome: developer.chrome.com/docs/extensions/develop/concepts/native-messaging (Windows `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>`, macOS `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`, Linux `~/.config/google-chrome/NativeMessagingHosts`; Chromium `~/.config/chromium`, `HKCU\Software\Chromium`).
- Chromium source: raw.githubusercontent.com/chromium/chromium/main/chrome/common/chrome_paths.cc (`NativeMessagingHosts` under the user data dir).
- Edge: learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging (`HKCU\Software\Microsoft\Edge\NativeMessagingHosts`, macOS `Microsoft Edge`, Linux `microsoft-edge`; Edge also falls back to the Chromium and Google\Chrome keys).
- Brave and Vivaldi: KeePassXC's installer, raw.githubusercontent.com/keepassxreboot/keepassxc/develop/src/browser/NativeMessageInstaller.cpp (both use the Google\Chrome key on Windows; Brave `BraveSoftware/Brave-Browser`, Vivaldi `vivaldi` / `Vivaldi` folders).
- Firefox: developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests (`allowed_extensions`; `HKCU\SOFTWARE\Mozilla\NativeMessagingHosts\<name>`; macOS `~/Library/Application Support/Mozilla/NativeMessagingHosts`; Linux `~/.mozilla/native-messaging-hosts`).

## Windows (HKCU, key under `Software\`, default value = manifest path)

| Browser | Detected by folder | Key written |
| --- | --- | --- |
| Chrome stable / Beta / Dev / Canary | `Google\Chrome`, `Chrome Beta`, `Chrome Dev`, `Chrome SxS` | `Google\Chrome` [V stable; channels U: no per-channel key is documented] |
| Chromium | `Chromium` | `Chromium` [V] |
| Edge stable / Beta / Dev / Canary | `Microsoft\Edge`, `Edge Beta`, `Edge Dev`, `Edge SxS` | `Microsoft\Edge` [V stable; channels U] |
| Brave / Beta / Nightly | `BraveSoftware\Brave-Browser[-Beta/-Nightly]` | `BraveSoftware\Brave-Browser` and `Google\Chrome` [V via KeePassXC] |
| Vivaldi | `Vivaldi` | `Google\Chrome` [V via KeePassXC] |
| Opera, Opera GX | `Programs\Opera`, `Programs\Opera GX` | `Google\Chrome` and `Chromium` [U: no vendor statement; both keys written on purpose] |
| Yandex | `Yandex\YandexBrowser` | `Google\Chrome` and `Chromium` [U] |
| Arc | `Packages\TheBrowserCompany.Arc_*` | `Google\Chrome` and `Chromium` [U] |
| Firefox | `Mozilla Firefox` | `Mozilla` (`allowed_extensions`) [V] |

Folders are looked for under `%LOCALAPPDATA%`, `%ProgramFiles%`, `%ProgramFiles(x86)%` and `%APPDATA%`.

## macOS (`~/Library/Application Support/<dir>/NativeMessagingHosts/<name>.json`)

`Google/Chrome` [V], `Google/Chrome Beta|Dev|Canary` [U], `Chromium` [V], `Microsoft Edge` and its `Beta|Dev|Canary` [V], `BraveSoftware/Brave-Browser[-Beta|-Nightly]` [V stable], `Vivaldi` [V], `com.operasoftware.Opera` [U], `com.operasoftware.OperaGX` [U], `Yandex/YandexBrowser` [U], `Arc/User Data` [U]. Firefox: `Mozilla/NativeMessagingHosts` [V], detected by `Firefox/`.

## Linux (`~/.config/<dir>/NativeMessagingHosts/<name>.json`)

`google-chrome` [V], `google-chrome-beta`, `google-chrome-unstable` [U], `chromium` [V], `microsoft-edge` [V], `microsoft-edge-beta`, `microsoft-edge-dev` [U], `BraveSoftware/Brave-Browser[-Beta|-Nightly]` [V stable], `vivaldi` [V], `vivaldi-snapshot` [U], `opera` [U], `yandex-browser` [U]. Opera GX and Arc have no Linux build. Firefox: `~/.mozilla/native-messaging-hosts` [V], detected by `~/.mozilla`. Snap and Flatpak browsers keep their data elsewhere and are not covered.

## Not verified on a real machine

Only Windows was run here (Windows 11, fake roots). The Mac and Linux scripts were run through Git bash with a fake HOME and `QAW_OS`. No browser was started to read the host back; every [U] row should be confirmed with the browser's `--enable-logging` the first time it is met. Release Firefox keeps only a signed add-on, and the Firefox id (`qa-wrap@qa-wrap.invalid`) is not an AMO-signed one yet.
