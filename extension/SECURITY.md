# Security: QA Wrap

What the extension does to protect the person using it, what it cannot do,
and how to report a problem. Written against the OWASP Browser Extension
Vulnerabilities cheat sheet and the Manifest V3 security model.

## Threat model, stated plainly

A browser extension that can hold `<all_urls>` and `debugger` is a powerful
thing to install. The only honest security claims are the ones that hold
*because of how it is built*, not because of who built it:

1. **Nothing leaves the machine unless you send it, and then only to the Jira
   site, tracker or webhook you configured, or the host you typed into the API
   tool.** There is no QA Wrap
   server. The code makes no request to any host of its own. Outbound traffic
   exists only to the Jira site, tracker API or webhook you configured, and the
   request you compose in the API tool, to the host you typed, with that
   profile's cookies when site access is granted; each only when you press a
   button that says so, and a managed policy that turns integrations off or
   lists other hosts refuses the API tool too. Redirects are followed when no
   host list is set and refused while one is, so a redirect cannot carry a
   request past the list.
2. **No remote code.** Every script ships in the package. axe-core is vendored
   and pinned. The declared content-security policy forbids anything else.
3. **No site access at install.** The package declares no `host_permissions`
   and no `content_scripts`. On a fresh install there is no script of ours in
   any page, because the extension has not been let into any site. `<all_urls>`
   is declared as an *optional* host permission and nothing more.
4. **Access is asked for at the moment of use, per site.** Pressing *Wake up*
   asks Chrome for the origin of the tab you are on, `https://host/*` and no
   wider, inside the click. The page scripts are then registered against
   exactly the origins granted, and every tool that reaches into a page refuses
   anywhere else with one sentence: *QA Wrap is not allowed on this site yet.
   Wake up here to allow it.*
5. **Nothing records until woken.** A granted site is a site the scripts may load
   in, not a site they record in. The eight page scripts (about 146 KB of source
   per frame) stay loaded on a granted origin, awake or asleep; the request hooks
   are installed, and anything is read or written, only after you wake the
   extension in that window.
6. **A first-run notice.** A first-run page states what is stored, what a
   recording captures, what masking does, the per-site permission model and the
   microphone line. Until it is accepted the popup offers nothing but that card.
   The gate is the popup; arming through another door does not read it.
7. **Secrets stay local.** Tokens and webhooks are one AES-GCM-256 ciphertext
   record in `chrome.storage.local`, opened with a non-extractable key or a
   passphrase you choose; never synced, never exported, masked in the UI. This is
   the same vault `PRIVACY.md` describes.
8. **Password fields and cookie values are not written into a session or an
   export**, and fields matching your privacy mask are never captured. The one
   exception is a saved cookie profile, which holds the values you saved, on this
   machine, until you delete it.

What *All sites* costs, stated plainly: pressing it hands the extension every
origin until you take it back, which is the power the old build held from the
moment it was installed. The difference is that it is now a press you made, it
is listed in Chrome's own extension settings, and one click there removes it.

What it cannot protect against: someone with access to your browser profile
can read anything the extension stored, including tokens. That is true of every
extension and every website's cookies; the mitigation is a token scoped to
issue creation, revoked when done. The Settings page says so beside the field.

## Measures, by layer

| Layer | Measure |
|---|---|
| Manifest | MV3; declared CSP `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'` (the side panel frames the popup page; nothing else may); no `host_permissions` and no `content_scripts`, so the install grants no site; `<all_urls>` declared under `optional_host_permissions` only; `externally_connectable` declared with an empty `ids` allowlist, so no other extension and no web page may open a channel to this one; `minimum_chrome_version` 116 |
| Site access | One function computes the whole content-script registration from `chrome.permissions.getAll()` and nothing patches it: `syncSiteScripts()` in `background/site-access.js`, run at every worker start and on `permissions.onAdded` and `onRemoved`. The registered set therefore equals the granted set, a revoked origin loses its scripts on the next navigation, and every page-touching handler is refused at the seam with `NOT_ALLOWED` when the origin was never granted |
| Consent | A first-run page the popup shows until it is accepted; the acceptance is recorded as `consentedAt` and `consentVersion` in `chrome.storage.local` and shown again from Settings |
| Managed policy | `managed-schema.json` carries `microphoneAllowed` and `hostPermissionsPolicy` (`ask` / `all` / `none`). The second decides what the wake card may ask for and grants nothing by itself: Chrome gives an administrator no way to hand a host permission to an extension |
| Messaging | The worker rejects messages whose `sender.id` is not this extension; every handler answers or times out with a named error; window-scoped arming is checked at the seam for every tool |
| Rendering | Page-derived strings (labels, URLs, console text) are rendered with `textContent`; the only `innerHTML` in the surfaces sets static icon markup from a constant table |
| Storage | Preferences in `chrome.storage.sync`; credentials as an encrypted record in `chrome.storage.local`; session data in IndexedDB in the profile; nothing in `localStorage` but the theme choice |
| Content scripts | None declared in the manifest: the eight page scripts are registered at runtime against granted origins, and the MAIN-world request hooks only while a window is awake. Isolated world for everything except those hooks, which must run in the page's world to see `fetch`; a closed shadow root for every overlay so the tool never appears in the page's DOM |
| Exports | Integration tokens and webhooks are never written into an export. A secret with a recognisable shape (a key, a JWT, a vendor token, a Basic-auth value, or a URL-query value named like a token, password or secret) is replaced before it is written, whichever field it was in, including the URL and the response preview. Only an opaque token with no recognisable shape, under an unremarkable name, cannot be told from ordinary text and reaches HAR, YAML and Postman as the page sent it. The provenance token names the session and build a file came from: it is attribution, not proof the file was not edited. Each stored screenshot and recording carries a SHA-256 checksum written when it was stored (computed in the offscreen document with `crypto.subtle`); a PNG seals itself in a `qaw-sha256` chunk, the session card, the HTML report footer and the footer of each Markdown document list the checksums in full (64 hex characters, so `sha256sum` can compare them), the session JSON carries them under `checksums`, every export names the SHA-256 of the exact bytes handed over, and `node tools/origin-check.mjs <file>` answers `intact` or `content changed`. A file cannot contain its own hash, so an export names its checksum beside the file and not inside it; the workbook exports carry none yet. A checksum shows a stored file is the file that was written. It is not a signature: a page can forge what it shows the extension, and anyone who can rewrite a file and its checksum together can pass the check (a per-page nonce stays parked; a signed manifest with a per-install key is reserved, not built) |
| Supply chain | `vendor/` pinned, and every file in it named in `NOTICE` with its licence and where its source is, asserted by `tools/release-check.mjs`. Fonts ship with `ui/fonts/OFL.txt`. Dev dependencies and working notes are excluded by name and by depth (`tools/lib-ship.mjs`) |
| Permissions | Each one, required and optional, has a row and a justification in `store/LISTING.md`; `desktopCapture` and every host are optional and asked for in use; `debugger` is required and stays detached until you press Measure |

## Reporting a problem

Write privately to naderalzghoulbusiness@gmail.com. Ordinary bugs go to the
same contact; `SUPPORT.md` says how.

- **Acknowledgement:** within 3 working days.
- **Fix or explanation:** within 30 days, either a patch release or a written
  reason it is not a vulnerability or cannot be fixed.
- **Credit:** named in the release notes unless you ask not to be.
- `site/.well-known/security.txt` carries the same contact once a site is live.

Say what you found, how to reproduce it, and what you think it exposes. A fix
ships as a patch release; the release notes name the issue.

Please do not include a token, a webhook URL or a cookie value: nothing here
needs one to reproduce a fault, and a credential in a message is a credential
that now has to be rotated.
