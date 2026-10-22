# QA Wrap for administrators

Hand-written for what exists today. Read it top to bottom once and you can deploy
QA Wrap to a managed fleet of Chrome or Edge in an afternoon.

Status marks used below: **tested** means a test in the repository checks it;
**unconfirmed** means it follows Chrome's documentation and has not yet been run on a
managed profile (the run is `work/managed/results.md`, T-062). Treat every
unconfirmed line as a recipe to try on one machine first.

## What QA Wrap is, for a deployment

- A local tool: sessions are stored in the tester's own browser. There is no server to
  allow-list; the only network traffic is to the site under test and to a tracker or webhook
  the tester configures (tested: `tools/test-independent.mjs`).
- It installs with **no site access**. The tester presses "Wake up" and Chrome asks for the
  one site they are on (tested: `tools/test-permissions.mjs`).
- `debugger` is a required permission, because Chrome does not allow it as optional. It is
  used only for code coverage, attaches when the tester presses Measure and detaches when the
  run ends. A policy that blocks `debugger` therefore blocks the install.
- It is distributed as a zip from the Chrome Web Store (unlisted) and Edge Add-ons.

## The policy keys

Chrome reads them from `chrome.storage.managed`, which exists only because
`managed-schema.json` ships in the package and the manifest names it. Push the values
through Group Policy, a macOS configuration profile or your MDM, under the extension's ID.
No key grants anything; they decide what the extension may offer. A blocked control stays on screen, greyed, with "Set by your organisation" and the key's name, and Settings has a "Policy in effect" list (tested: `tools/test-policy-registry.mjs`). Every refusal names its key. A value of the wrong type restricts nothing.

| Key | Type | Values | Effect |
|---|---|---|---|
| `microphoneAllowed` | boolean | `true` (default), `false` | `false` removes the microphone from QA Wrap entirely: the option disappears and every recording path refuses a microphone. Screen, tab and tab sound are unaffected. |
| `hostPermissionsPolicy` | string | `ask` (default), `all`, `none` | What "Wake up" may offer. `ask`: the current site, with "All sites" as a second choice. `all`: the first wake asks for all sites in one press (it grants nothing by itself, an administrator cannot grant a host permission on a tester's behalf). `none`: no request at all; QA Wrap works only on sites you allowed through ExtensionSettings, and the popup says an administrator has decided. |
| `replayAllowed` | boolean | `true` (default), `false` | `false` stops the session replay being recorded and shown. Screenshots, the timeline and the report are unaffected. |
| `retentionDaysMax` | integer | whole days above 0; `0` or absent is no ceiling | A tester may choose a shorter window, never a longer one and never "keep for ever". Read at the daily clean-up, so it applies to existing profiles too. |
| `integrationsAllowed` | boolean | `true` (default), `false` | `false` stops anything being sent to Jira, a tracker or a chat destination. Saving to the tester's own disk is unaffected. |
| `integrationHosts` | array | host names, e.g. `jira.example.com` | When not empty, integrations reach only those hosts and their subdomains. |
| `debuggerToolsAllowed` | boolean | `true` (default), `false` | `false` turns off code coverage, the one tool that attaches Chrome's debugger. The `debugger` permission itself stays required. |
| `redactionLocked` | boolean | `false` (default), `true` | `true` keeps redaction on, with the optional national-id and email families on too, whatever a tester or a synced setting says. |
| `consentMode` | string | `user` (default), `organisation` | `organisation` opens no welcome tab on install (one tab per machine on a fleet is noise). The popup's first-run card shows your notice link (`consentUrl`) and the same "Read the notice" step, and QA Wrap still arms only after the tester accepts the current notice: there is no silent pre-accept. Without a valid `consentUrl` the key is ignored. Whether employment consent is a valid basis is for your data-protection officer to decide. |
| `consentUrl` | string | an `https:` address | The notice your organisation gives testers, linked from the popup in organisation mode. Anything but an https link is ignored. |

Recommended posture for an enterprise: `hostPermissionsPolicy: none`, plus
`runtime_allowed_hosts` for the internal applications that are tested (below).

Example managed-storage value:

```json
{ "microphoneAllowed": false, "hostPermissionsPolicy": "none", "retentionDaysMax": 30, "redactionLocked": true }
```

## ExtensionSettings recipes

Set these in the `ExtensionSettings` policy, keyed by the extension ID. All of these are
Chrome's own policy language; the QA Wrap-specific part is only which values suit it.
(unconfirmed on a managed profile until T-062.)

Install and pin to the toolbar:

```json
{
  "ExtensionSettings": {
    "<extension-id>": {
      "installation_mode": "force_installed",
      "update_url": "https://clients2.google.com/service/update2/crx",
      "toolbar_pin": "force_pinned"
    }
  }
}
```

Use `normal_installed` instead of `force_installed` if testers may remove it. For Edge, use
the Edge update URL and the Edge extension ID of the Edge Add-ons listing.

Edge pins with a different key. Replace `toolbar_pin` with `"toolbar_state": "force_shown"`
(`default_hidden` is the other value), and keep the Edge update URL. Firefox needs no policy:
its manifest puts the button on the toolbar at install. Brave, Opera and DuckDuckGo have no
pin policy, so the welcome page shows testers how to pin it.

The managed flavour (`dist/chrome-managed`, built with `--flavour managed`) has no `debugger`
permission, so it installs where policy blocks it. Its entry:

```json
{
  "ExtensionSettings": {
    "<extension-id>": {
      "installation_mode": "force_installed",
      "toolbar_pin": "force_pinned",
      "blocked_permissions": ["debugger"]
    }
  }
}
```

Allow named sites without a tester prompt (Chrome 155 and later; earlier versions
ignore the key):

```json
{
  "ExtensionSettings": {
    "<extension-id>": {
      "installation_mode": "normal_installed",
      "runtime_allowed_hosts": ["https://staging.example.com", "https://*.intranet.example.com"]
    }
  }
}
```

Block the sites you never want it on, whatever a tester chooses:

```json
{ "ExtensionSettings": { "<extension-id>": { "runtime_blocked_hosts": ["*://*.bank.example.com"] } } }
```

Decline screen capture. `desktopCapture` is an optional permission, so the extension
installs with it blocked and is declined when a tester presses Record screen:

```json
{ "ExtensionSettings": { "<extension-id>": { "blocked_permissions": ["desktopCapture"] } } }
```

Do **not** put `debugger` in `blocked_permissions`: it is required, and the install fails.
The `desktopCapture` recipe is unconfirmed until T-062 records the outcome.

## Things to know before you deploy

- **"All sites" is a permanent grant** until the tester removes it from the extension's
  site access. Setting `hostPermissionsPolicy: none` removes the button that would ask.
- **Updates and permissions.** If a release adds a permission, Chrome disables the
  extension until the user (or policy) accepts it. Release notes name any such change.
  Test an update on one machine before a fleet sees it.
- **Mirror and pin.** If you host the extension yourself, mirror the exact zip named in
  `RELEASE-<version>.json` (it records the SHA-256) and pin the version in your update
  manifest. A same-version rebuild is not the same file: compare the hash.
- **Retention.** Fresh installs delete finished sessions after 30 days; an upgraded install
  keeps the value it had.

## What is not built

No single sign-on, no central audit log, no data residency choice (data leaves the
browser only for the Jira site, tracker or webhook you configure, so there is no
QA Wrap region to choose), no fleet dashboard, and no generated `.reg` or
`.mobileconfig` files; the JSON above is the whole interface. A key beyond the list above waits for a named buyer.

## Support

The developer contact on the Chrome Web Store listing, for deployment questions and, privately, for a
vulnerability. See `SLA.md` for what to expect.
