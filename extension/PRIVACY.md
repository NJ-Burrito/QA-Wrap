# QA Wrap privacy policy

Published by Nader Alzghoul.

**Effective 23 October 2026** (published with the public source release), revised from
the version of 8 September 2026. Applies to the
QA Wrap browser extension on
every browser it is published for: Chrome, Edge, Brave, Opera, Opera GX and the
DuckDuckGo desktop browser. The policy is the same on all
of them, because the extension does the same thing on all of them.

## The one-sentence version

QA Wrap is local-first: everything it records stays in your browser profile
on your machine, and nothing leaves it except where you configure Jira, a tracker or a webhook, or where you send the one request you wrote in the API tool or run the link checker, and press a button that names where the data is going. The two powers that start by themselves, recording and a screenshot on a new error, keep what they record in this browser; filing and sharing stay a button you press.

## What it records, and where it goes

While a session is recording, and only in a window you have woken up, on the
focused tab of that window, the extension keeps:

- the clicks, typing, navigations and form steps you perform on the page under
  test, with a locator for each element;
- the page's network requests and console output, so a failure can be linked
  to the action that caused it;
- screenshots, full-page captures and screen or tab recordings you start, or that start by themselves on a site you ticked;
- notes you type, the charter you set, and the settings you choose.

All of it is written to IndexedDB and `chrome.storage` inside your browser
profile. There is no QA Wrap server. The extension makes no request to any
host of its own, carries no analytics, and loads no remote code; the
accessibility engine (axe-core) is bundled inside the package.

The one exception is the **update check**. Once a day, and a minute after the browser starts, QA Wrap asks GitHub whether a newer release exists: one anonymous GET of `api.github.com/repos/NJ-Burrito/QA-Wrap/releases/latest`, with no cookies, no identifier and nothing about you or your tests. It is on by default and the "Check for updates" tick in Settings switches it off, and the button beside it runs the check once on demand. If one exists, the popup and Settings show a card with what changed; updating is always your press, and "Not now" hides that version. A read-only GitHub token is optional and only for a fork or private mirror whose releases GitHub hides from anonymous readers; if you paste one it stays in this browser and is sent only to GitHub.

When you switch on "pre-roll buffer" (off by default), an awake tab keeps its last 60 seconds of events in memory on the page only; nothing is stored or sent until you start a session, and the buffer is discarded on navigation, tab close, sleep, or switching it off.

The **2-minute replay buffer** is off by default and is switched on one site at a time, from the popup, on a window you have woken. While it is on, that page keeps the last 120 seconds of what the recorder already sees (your clicks and typing, console messages, and network calls as address, status and time only, with no bodies or headers) in the page's own memory. The buffer is not written to disk and is not sent anywhere. Anything older than 120 seconds is dropped as it ages, and closing or reloading the page, putting QA Wrap to sleep or switching the site off throws it away. Only when you press **Save last 2 minutes** does a session start, pre-filled with that buffer; from then on it is an ordinary session, stored like any other. Values you masked, password fields and credential-shaped words are masked before they are kept, and again when the session is saved. While the buffer is on, the page shows a small note saying so.

### What it deliberately does not record

Four layers, applied before anything is written, in this order:

1. **What you masked by hand.** Press *Mask real data* and click anything on
   the page: a name, a national number, a whole column. It is covered by an
   opaque block for the rest of the session: in every screenshot, in the video,
   through every navigation. The words underneath are removed from the event,
   skipped by the page map, and never written into the report. The report says
   *how many* values were masked, so a reviewer knows something was withheld
   rather than never seen.

   A block, not a blur. A short string behind a Gaussian blur can be recovered
   by rendering candidates and comparing, which has been done to published
   redactions more than once.

2. **What has the shape of a secret.** Payment card numbers (validated against
   the Luhn check digit, so an order reference is not mistaken for one), IBANs
   (validated mod-97), bearer tokens, API keys, JSON web tokens and private key
   blocks are removed from every recorded value. National and record numbers,
   and email addresses, can be added in Settings. They are off by default
   because a ten-digit national number and a ten-digit order reference are the
   same shape, and a tester testing order references needs to read them.

3. **What has the name of a secret.** A field of type `password`, an
   `autocomplete` of `cc-number` or `one-time-code`, or a label matching
   `pass|secret|token|otp|pin|cvv|card|iban|كلمة المرور`, recorded as "a
   password was typed", never as its value. You can add your own pattern.

4. **Cookie values**, never written into a session or an export, even while the
   cookie editor is open. The one place a cookie value is kept is a **saved cookie
   profile**: if you save one, its cookies, values included, sit in
   `chrome.storage.local` on this machine until you delete that profile.

Two things these layers do not reach. A request you compose by hand in the
request tool is stored as you sent it, with its `Authorization` header and body.
Every event the extension stores is scanned for the shape of a secret, whichever
part of the extension wrote it: the text fields, `url`, `redirectedTo`,
`responsePreview`, `resBody`, `stack`, `error`, `graphqlError`, `frameUrl`,
`tabTitle`, header values (including headers sent as a list), the request body,
and the `locator`, `selector` and `xpath` of an element. A key, a JWT, a vendor
token, a Basic-auth value, or a URL-query value named like a token, password or
secret is replaced before it is written. So is the value under a key named like a
password, secret, token, API key, session id, otp, pin or cvv, in JSON or form text,
even when the text is cut off before the JSON closes. The replay log is scanned the
same way before it is stored. The one admission: an opaque token with
no recognisable shape, such as a random string under an unremarkable name, cannot
be told from ordinary text, so it reaches the HAR, YAML and Postman exports as
the page sent it. Treat those files as you would the page's own traffic.

None of this is a substitute for judgement: no rule can know that a name on
screen belongs to a real patient. That is what masking by hand is for, and why
the two exist together.

## When data does leave your machine

Only when you set up one of the 18 services in Settings → Integrations, and only
when you press the corresponding button on a report:

| Destination | What is sent | Where |
|---|---|---|
| Jira | the defect report or test case for one session, and the evidence attachments you ticked | your own Jira site, using your personal API token |
| GitHub, GitLab, Azure DevOps, Linear, Trello, ClickUp, Asana, Shortcut, YouTrack | the defect report for one session, and evidence attachments where the tracker accepts them | the tracker's API (your own server for a self-hosted one), using a personal token you paste |
| Slack, Microsoft Teams, Mattermost (as a webhook), Discord, Google Chat, a custom webhook | a summary of one session | the webhook URL you configured |
| Mattermost (as a signed-in account, from the report page) | a summary of one session, after your organisation's policy is checked and the text is scanned for secrets; the send is listed under what left this machine | the Mattermost server address you typed, using your personal access token, which is kept encrypted in the credential vault |
| Telegram | a summary of one session | `api.telegram.org`, using the bot token and chat you configured |
| The API tool (the Send a request panel) | the one request you wrote, after the {{variables}} you can see resolved, and with this browser profile's cookies for that host when you have granted site access | the host you typed into its URL box, plus the host a redirect lands on (that host gets its own row in the egress ledger); your organisation's policy (integrations off, or a list of allowed hosts) is checked first and refuses before anything is sent; a redirect is followed when no host list is set, and refused (not followed) while your organisation's policy lists hosts |
| Link checker (the Links button) | a HEAD or GET request to each link on the page you chose, sent without cookies; addresses on your own machine or network are skipped unless the page is one; the run is listed under what left this machine as a count, with no link text | the host of each link; your organisation's policy (integrations off) is checked first and refuses before anything is sent |
| Email (.eml) | nothing is sent: a message file is written to your machine, for you to open and send yourself | your own disk |

**Evidence attachments.** When you file to Jira you choose what travels with the
report: screenshots, and the export formats you tick, such as the report file, a
screen or tab recording, or the network log (HAR). Nothing is attached that you
did not tick, and nothing is attached without the press.

**Secret scanning covers text, not media.** Before anything leaves, the report
text and every text attachment (report files, logs, HAR) are scanned for the shape
of a secret; a hit blocks the send or, if you choose, is replaced by a marker.
Screenshots, recordings and other media attachments are **not secret-scanned**:
no scanner looks inside an image or a video. The filing result lists the files
that were not scanned, so check them by eye, and use *Mask real data* before
capturing, because masked values are covered in the pixels themselves.

**Per-service hosts.** The `<all_urls>` permission granted at install already
covers these hosts (for example `https://your-company.atlassian.net`,
`https://api.telegram.org`, or the webhook's own host), so Chrome does not ask
again when you set up a service. Data goes to them when you press that service's own
button and confirm. Take the access back in Chrome's extension
settings under *Site access* and the services stop.

Each of those buttons asks for confirmation and says that the data is leaving
your machine. Leave the integration empty and the button never appears.

### The agent bridge (off by default)

If you switch on **Agent bridge** in Settings, QA Wrap asks the browser for the optional `nativeMessaging` permission and answers read-only questions from a small helper program you install yourself (`npx qa-wrap-bridge`), which your coding agent (Claude Code, Cursor) starts as an MCP server. The agent can ask for the list of sessions, one session as `session.json`, its failures, or the AI brief. It cannot start, change or delete a session, and the helper opens no network connection: it talks to the browser and to your agent on this computer only, through a local socket protected by a key kept in your user folder. Everything it returns goes through the same secret masking as an export. What your agent then does with that text, including sending it to a model, is the agent's behaviour and not QA Wrap's, so switch the bridge on only for an agent you trust with your test data. Turning the bridge off hands the permission back.

### AI writing (optional, off by default)

If you turn on AI writing in Settings, the **Suggest title and steps** button appears in a report. When you press it, QA Wrap shows you a rough count of what will be sent and the exact text, and only when you press **Send** does it send that text, once, to the provider you chose (Anthropic, OpenAI or OpenRouter), with your own API key. The text is the same text «Copy for AI» makes: the steps, the failing requests, the console errors and the environment, with passwords, tokens and other secrets masked first. Screenshots, recordings, cookies and saved credentials are not sent. Your key is kept only on this computer, is not synced or exported, and you can remove it in Settings. The first time, the browser asks permission to reach that provider. QA Wrap calls no other AI service, and it sends only when you press Send. Each send appears in the list of what has left your machine (host and size, no content). What the provider does with the text is set by your agreement with them. The answer is shown as «suggested» next to what was recorded; your recorded steps and expected result stay as they were.

### Files you export do not phone home either

An exported HTML report, SRS, manual or link map is opened somewhere else, often
on a machine that is not yours, and until 3.1.0 it carried one line that
mattered here: the shared document stylesheet pulled its typeface from
Google's font service. QA Wrap never made that request. The browser that opened
the file did, which told Google's font service the reader's IP address, their
browser, and the moment they opened a QA Wrap document.

**That line has been removed.** The document carries the typeface instead: the
Thmanyah faces out of the extension's own `ui/fonts.css`, written into the file as
base64 `data:` URIs, which asks nobody for anything. An
exported document now makes **no network request at all**, so nothing about who
reads one of these files, or when, reaches anybody. `tools/test-exporters.mjs`
opens a freshly built report in a real browser, waits for its fonts, records
every request it attempts, and fails if there is one.

Documents exported before this version still carry the old line. Deleting the
`@import` line at the top of their `<style>` block stops it; nothing else in the
file depends on it.

Tokens and webhooks you paste are **encrypted at rest**: one AES-GCM-256
ciphertext record in `chrome.storage.local` on this machine, opened with a
non-extractable key kept in the extension's own IndexedDB, or with a passphrase
you choose in Settings (PBKDF2-SHA256). They are decrypted only inside the
extension's service worker at the moment of use; extension pages see them masked
(`••••` and the last four characters). The one exception is the Mattermost account
token, which the report page opens only while it is posting to Mattermost. They are never synced through your Google
account, never written into an export, and never sent anywhere except the service
they belong to when you press File. The vault defeats disk and profile scanners
and sync leaks; it does not defeat malware running as you while QA Wrap is
unlocked, so use tokens scoped to issue creation and revoke them when you are
done.

Saved cookie profiles and the variables you keep in the API tool are sealed the same way: each is its own AES-GCM record in `chrome.storage.local`, opened with the same key. A variable whose name looks like a credential is shown masked, with a Show button. Erase all removes both records without asking for the passphrase.

Chrome sync, when you have it on, carries only your preference settings: the recording, retention, sound, keyboard and layout choices and the interface language. Your tester name, the workspace you joined and the save-folder name are kept in `chrome.storage.local` on this machine, and credentials stay in the vault. Three of them are text you type: the "Save into" download folder, the extra mask pattern and the extra redaction words. They sync with the rest, so keep secrets and client names out of them, or switch Chrome sync off. Session data, screenshots and recordings stay on this machine.

## Retention and deletion

**Finished sessions are deleted after 30 days by default.** The session record,
its events, its screenshots, its recordings and its replay log go together, on a daily schedule
and once when the browser starts, so a machine that is switched off overnight
does not skip a day. A running session is never touched. You can set the window
to anything from one day to a year, or to *never*. But *never* is a choice you
make, not the state you are left in.

**A pinned session is kept past the retention window.** A session you pinned is not
deleted by the daily sweep, whatever its age, until you unpin it (the **Keep** switch); Erase all and Delete still remove it.
**You are told a week ahead.** Once a session is within eight days of the window, a desktop notice says
how many will go (a count, never content) and the sweep takes none of them before seven days have passed.
After a crash the first popup open shows one card with the number of events that were saved; it is
removed when you dismiss it. A recording that reaches its event limit goes on as "part 2" of the same
test, in the same window, without a click; notes and screenshots you make are always stored.

**A session the browser never let finish is closed, not kept for ever.** If
Chrome is killed, the machine loses power, or the extension is updated while a
session is recording, nothing gets the chance to write the session's end time,
and a session with no end time used to be skipped by the deletion above forever,
because a session still in progress must not be deleted out from under you. At
the next start, any session left open that is not the one you are recording now
is marked **interrupted** and given an end time: the moment of its last recorded
event, or its own start if it recorded nothing. From then on it is deleted on the
same schedule as any other. Four things it can no longer know, being how many values
were masked, which cookies were present, how many rules fired, which tools were
used, are recorded as unknown rather than as zero.

**If you upgraded from an earlier version, nothing is deleted until you choose a
window.** A profile that never had a retention setting is read as *never*, not as
30 days, so an update cannot quietly delete sessions you recorded before the
setting existed. Settings → Privacy asks you once. Thirty days is the default for
a fresh install, where it is a default you are told about rather than a policy
applied to history.

Settings → Privacy has a **Run it now** button, so you can watch the policy work
rather than take its word for it.

**Erase all** (Settings, then Privacy) removes every session with its events,
screenshots, recordings and replay logs, and your saved cookie profiles. Your
settings are kept. A saved cookie profile belongs to no session, so retention
never touches it: it goes with Erase all, or when you delete that profile.

You can also delete any session by hand from the timeline panel or the report.
Exports you have saved are ordinary files in the folder you chose, and are not
touched by any of this. They are yours. Uninstalling removes the database and
the settings from the browser profile.

### Everything stored, by place

<!-- store-registry:start -->
| Holds | Where | Kept | Removed by | Syncs |
| --- | --- | --- | --- | --- |
| session records | IndexedDB `sessions` | retention days | Erase all | no |
| clicks, typing, requests, console (secrets masked) | IndexedDB `events` | retention days | Erase all | no |
| screenshots | IndexedDB `captures` | retention days | Erase all | no |
| screen and webcam recordings | IndexedDB `media` | retention days | Erase all | no |
| recording parts while a clip is written | IndexedDB `mediaParts` | retention days | Erase all | no |
| clips interrupted mid-write | IndexedDB `mediaPending` | retention days | Erase all | no |
| typed values for replay | IndexedDB `replay` | retention days | Erase all | no |
| saved cookie profiles, values included (encrypted) | chrome.storage.local `cookieProfiles` | until removed | Erase all | no |
| sessions a crash closed: id, saved event count and time, no content, shown once on the next popup open and removed when you dismiss it | chrome.storage.local `interrupted` | until removed | Erase all | no |
| time of the last retention sweep | chrome.storage.local `lastPurgeAt` | until removed | Erase all | no |
| count of sessions the sweep removed | chrome.storage.local `purgeLog` | until removed | Erase all | no |
| per-session tool state: rules, tools used, lost-event count, raw start URL (memory only) | chrome.storage.session `sessionState:` | browser session | Erase all | no |
| the test-suite draft you are building | chrome.storage.session `suiteDraft` | browser session | Erase all | no |
| which screenshot the reporter will attach | chrome.storage.session `qawReporterShot` | browser session | Erase all | no |
| the note or charter you typed and did not send yet, masked, at most 2 KB per field; gone when the browser closes, the session is deleted or the text is sent | chrome.storage.session `popupDraft` | browser session | Erase all | no |
| windows watched for security headers | chrome.storage.session `uqa.secHeaders.windows` | browser session | Erase all | no |
| security headers seen per page | chrome.storage.session `uqa.secHeaders.seen` | browser session | Erase all | no |
| your settings, except name, workspace and folder name (local if sync is off); the download folder, the extra mask pattern and the extra redaction words sync too, so keep secrets and client names out of them | chrome.storage.sync `settings` | until reset | Settings reset | yes |
| settings kept on this machine only: your name, the workspace you joined, the save-folder name, the recording-dot switch | chrome.storage.local `settingsLocal` | until removed | Settings reset | no |
| tracker credential, encrypted | chrome.storage.local `secrets` | until removed | Settings reset | no |
| vault record for the credential passphrase | chrome.storage.local `qw0` | until removed | Settings reset | no |
| last 50 handler failures (name and short message, addresses and hosts stripped), read only by the support bundle | chrome.storage.local `handlerRing` | until removed | Erase all | no |
| the last 5 times the background worker took to start, in milliseconds, read only by the support bundle | chrome.storage.local `bootMs` | until removed | Settings reset | no |
| a count of tool uses on this machine, a number with no detail, read only by the support bundle | chrome.storage.local `toolUseTicks` | until removed | Settings reset | no |
| API variables, tokens included (encrypted) | chrome.storage.local `apiEnvironments` | until removed | Erase all | no |
| what left this machine: time, kind, host and size of the last 200 sends, with no content | chrome.storage.local `egressLedger` | until removed | Erase all | no |
| your Mattermost account: server address and chosen channel (the access token is kept in the encrypted vault) | chrome.storage.local `mattermost` | until removed | Settings reset | no |
| the sites where you switched the 2-minute replay buffer on (address only, off until you tick it), listed and removable in Settings | chrome.storage.local `bufferSites` | until removed | Settings reset | no |
| whether you switched the agent bridge on (a yes or no) | chrome.storage.local `agentBridge` | until removed | Settings reset | no |
| the sites you chose to wake up on by itself (address only, off until you tick it), listed and removable in Settings | chrome.storage.local `rememberedSites` | until removed | Settings reset | no |
| the sites where you chose to start recording by itself (address only, off until you tick it), listed and removable in Settings | chrome.storage.local `autoStartSites` | until removed | Settings reset | no |
| the sites where you chose an automatic screenshot on the first error of each kind (address only, off until you tick it), listed and removable in Settings | chrome.storage.local `autoShotSites` | until removed | Settings reset | no |
| whether the recording dot shows on pages (a yes or no, on until you switch it off in Settings) | chrome.storage.local `pageIndicator` | until removed | Settings reset | no |
| whether the tools list in the popup is open (a yes or no) | chrome.storage.local `toolsOpen` | until removed | Settings reset | no |
| the last note type you chose (bug, issue, question or note) | chrome.storage.local `noteType` | until removed | Settings reset | no |
| AI writing choice, no key | chrome.storage.local `aiWriting` | until removed | Settings reset | no |
| your AI key, local only | chrome.storage.local `aiWritingKey` | until removed | Settings reset | no |
| Jira helper switches: your Jira address, project keys, labels and what to be notified about, no password | chrome.storage.local `qawJira` | until removed | Settings reset | no |
| Jira helper: the page direction (RTL or LTR) you chose for each Jira address, kept until Chrome closes | chrome.storage.local `qawJiraDir` | until removed | Settings reset | no |
| Jira helper: where you dragged the RTL or LTR tab along the top edge, for each Jira address (pixels from the nearer side) | chrome.storage.local `qawJiraPos` | until removed | Settings reset | no |
| Jira helper: the Jira addresses you opened and the API version each one speaks, for the notifications and the Settings list (no page content) | chrome.storage.local `qawJiraSeen` | until removed | Settings reset | no |
| interface language | chrome.storage.sync `qawLanguage` | until removed | kept | yes |
| small internal values (flags, counters, pointers, timestamps): `lastSessionId`, `masks:` | chrome.storage.session | browser session | Erase all | no |
| small internal values (flags, counters, pointers, timestamps): `autoStarted`, `autoShotState`, `autoPauseUntil`, `activeSessionId`, `activeSessionsByWindow`, `dismissedSessionId`, `uqa.doneJob`, `uqa.diskWarn`, `uqa.updateNew`, `qawUpdateDismissed`, `recordingViewportRun`, `recordableTabs`, `armedWindows`, `recordingWindowId`, `coverageTab`, `coverageMode`, `floatWindowId`, `managedPolicy`, `qwk`, `rememberWoke`, `autoWoke` | chrome.storage.session | browser session | closing the browser | no |
| small internal values (flags, counters, pointers, timestamps): `sessionSeq`, `consentedAt`, `consentVersion`, `consentRevision`, `firstReportOpenedAt`, `floatBounds`, `floatBoundsV`, `storagePersistence`, `qawTheme` | chrome.storage.local | until removed | kept | no |
<!-- store-registry:end -->

## The standards this is built against

Nothing here is a certification. These are the controls a certification would
ask to see, named so that a security review can check them off.

| Measure | What it answers to |
|---|---|
| Masking by hand; redaction by value shape | **GDPR Art. 5(1)(c)** data minimisation |
| Both on by default | **GDPR Art. 25** protection by design *and by default*; **ISO/IEC 27701 cl. 7.4** |
| Opaque blocks over values in captures | **ISO/IEC 27002:2022 control 8.11** data masking |
| 30-day retention, deletion including media, and interrupted sessions closed so retention reaches them | **GDPR Art. 5(1)(e)** storage limitation |
| Everything local; no analytics, no telemetry, no remote code | **GDPR Art. 5(1)(f)** integrity and confidentiality; Chrome Web Store **Limited Use** |
| No site access at install; one origin asked for at the moment it is used | **GDPR Art. 5(1)(c)** data minimisation; Chrome Web Store **minimum permissions** |
| A first-run notice the popup shows, and nothing else, until it is accepted | **GDPR Art. 13** information at collection; Chrome Web Store **prominent disclosure and consent** |
| Egress only on an explicit press, to a destination you configured | **GDPR Art. 5(1)(b)** purpose limitation |
| Tokens in an AES-GCM vault in `storage.local`, never synced, never exported | **ISO/IEC 27002:2022 control 8.24** use of cryptography and secrets |
| Manifest V3, strict CSP, no remotely hosted code, no `eval` | **OWASP** secure extension practice; Web Store policy |

The extension has no server. There is no account, no identifier, no analytics
and no crash reporting: nothing to breach, because nothing is collected. That
is a design decision rather than a promise, and `tools/release-check.mjs`
fails the build if an analytics endpoint or remotely hosted code ever appears
in the package.

## Which sites it is allowed on

**QA Wrap can read every website from the moment it is installed.** The install
dialog says so ("read and change all your data on all websites"), because the
extension holds the `<all_urls>` host permission from install. Being able to read
a site is not capturing it: QA Wrap captures only after you press **Wake up**
or **Start**, and then only the focused tab or window, and only for as long as it
is the focused one.

Press **Wake up** on the page you are testing and Chrome does not ask again: the
access was given at install. Moving to another tab or window moves the capture
with the focus.

**Asleep does not mean nothing is loaded.** Asleep means no session records, no
request hook is installed and no tool acts. On every site, QA Wrap's eight page
scripts (about 146 KB of source per frame) stay loaded and record only once
you wake that window.

Going to sleep leaves the access in place. Take the access back in Chrome's own extension
settings under *Site access* and the extension's scripts leave those sites with
it; the page scripts are registered from the grant every time it changes
(`background/site-access.js`).

**The Jira helper** runs on Jira pages (your Jira host and `*.atlassian.net`). It
changes the page's interface; it sends a desktop notification only when you turn
notifications on, and only to a Jira host that is yours.

**Test this site** does the same three things in one press: it asks for the site, wakes the window and starts a session.
*Wake up on this site by itself next time* is off until you tick it, and when you do QA Wrap keeps that site's address on
this machine only (`rememberedSites`) and wakes the window when you open the site again; Settings lists every remembered
site and removes any of them.

Two more powers are off until you tick them, each under the wake-up tick and for that site only. *Also start recording by
itself on this site* keeps the site's address (`autoStartSites`) and starts a session when you open the site in an awake
window; it records only what you do on that site, in this browser, shows a small dot on the page, and stops after 30
minutes without activity. *Also take a screenshot on the first error of each kind* keeps the site's address
(`autoShotSites`) and saves a screenshot of the tab you are looking at the first time the site shows an error of a kind it
has not shown in that test; screenshots are not scanned for secrets and stay in this browser. Neither power uploads
anything: filing and sharing stay a button you press. The dot has its own switch in Settings (`pageIndicator`). Settings lists every site with these switches and
turns any one of them off.

Until a window is woken, every tool that reaches into a page refuses in the
same words: *QA Wrap is not allowed on this site yet. Wake up here to allow
it.* A window you have not woken is not recorded, even though the
page scripts are present and idle.

On a **managed machine** an administrator can set `hostPermissionsPolicy` and
decide what that press may offer: `ask` (the default: this site, with *All
sites* beside it), `all` (the first wake asks for every site in one press), or
`none` (no request at all, and the popup says an administrator has decided).
The policy grants nothing by itself. Chrome gives an administrator no way to
hand a host permission to an extension on your behalf.

## The notice you read first

On installation QA Wrap opens one page, in Arabic and English, before any tool
can be used: what it stores and where, what a recording captures, what masking
does and does not do, that it can read every site but captures only a window
you wake, and the line about the microphone. Until you accept it the popup shows that
card and the link to the tutorials, and nothing else.

Accepting writes three values into `chrome.storage.local` on this machine:
`consentedAt`, `consentVersion` and `consentRevision`: the moment you accepted, the
build you accepted it for and the revision of the welcome wording. They identify
nothing and nobody, they are never synced and never exported. The extension compares
`consentRevision` with the current revision when it starts, so if the wording is
revised you are asked again; `consentVersion` only records the build, and an ordinary
update does not re-ask. Settings has **Show the welcome
page again**.

## Permissions, and why each one is there

| Permission | Used for |
|---|---|
| `storage`, `unlimitedStorage` | sessions, screenshots and recordings in your profile; a long session can exceed the default quota |
| `activeTab`, `tabs` | the URL and title of the page under test; opening the report and settings pages |
| `scripting` | injecting the tools into the page you are testing, on demand, and registering the page scripts |
| `webNavigation` | recording navigations, the status of the page itself, and the frame tree a locator inside an iframe needs |
| `webRequest` | reading six security headers off each response while a session is recording and only on sites you have granted access to (Content-Security-Policy, Strict-Transport-Security, Access-Control-Allow-Origin, X-Frame-Options, Referrer-Policy, Permissions-Policy), so the fine-print report measures them instead of asking you to. Observation only: nothing is blocked, modified or redirected, no other header is kept, values are cut at 512 characters, and the listener is attached only while a session runs and only for that window |
| `cookies` | the cookie editor and saved cookie profiles |
| `contextMenus` | the right-click menu entries |
| `notifications` | a desktop notice when a session is saved, when a recording starts or stops, and when the extension goes to sleep; nothing in one is sent anywhere, and Settings turns them off |
| `sidePanel` | the docked workbench, for testers who prefer it to the floating window |
| `system.display` | reading the size and position of your screens (nothing else about them), only to place the floating test window where it does not cover the page under test |
| `clipboardWrite` | copying a locator |
| `alarms` | the daily purge of sessions older than the retention period you set, which must run even while the service worker is suspended |
| `downloads` | saving exports to the folder you chose |
| `offscreen` | encoding recordings and GIFs, which needs a document |
| `tabCapture` | recording the tab when you press Record |
| `debugger` | measuring which of the page's JavaScript ran (code coverage) when you press Measure; Chrome shows it at install, and the debugger stays detached until you press Measure |
| **optional** `nativeMessaging` | the agent bridge: talking to the helper program you installed, so your coding agent can read your sessions. Asked for when you switch **Agent bridge** on in Settings, and handed back when you switch it off |
| the host of the AI provider you chose (`api.anthropic.com`, `api.openai.com`, `openrouter.ai`) | AI writing: sending the report text you asked to be suggested. Covered by the `<all_urls>` permission held from install; the text is sent only when you press **Suggest title and steps** with a key set |
| **optional** `desktopCapture` | recording a window or the whole screen; asked for the first time you choose one of those, and refusable |
| the site you are on | covered by the `<all_urls>` host permission below; it is captured only after you press *Wake up* or *Start*, and then only while its tab or window is the focused one |
| the address of a service you set up | covered by the `<all_urls>` permission held from install, so there is no extra prompt; data goes there only when you press that service's button and confirm |
| host permission `<all_urls>` | held from install, and shown on Chrome's install dialog as reading and changing your data on all websites. It lets QA Wrap's page scripts be present on every site; they record only once you wake that window, and Chrome's own extension settings list it |

## Licence, changes and contact

QA Wrap is open source under the MIT licence (`LICENSE`); the source is public, so you can read exactly what this policy describes. Third-party components keep their own licences (`THIRD-PARTY-NOTICES.md`).

Changes to this policy are recorded in the extension's release notes and in the repository's history.
Questions, corrections and data requests: open an issue at https://github.com/NJ-Burrito/QA-Wrap/issues, or see https://nj-burrito.github.io. Your data lives only in your browser, so the controls are yours (Settings > Privacy > **Erase all**, per-session Delete, or uninstalling the extension).
