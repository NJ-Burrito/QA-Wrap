# Support

**QA Wrap**, published and maintained by Nader Alzghoul.

- Contact: naderalzghoulbusiness@gmail.com

The website and mailbox, when there are any, live in `brand/brand.json` and nowhere else; an empty value means
none, and the link that would read it is hidden. `node tools/build-brand.mjs --write` copies them into the
manifest and the documents.

This page says what you can expect and, more usefully, how to get a fix
quickly. It does not promise anything that cannot be delivered by one person, and
[SLA.md](SLA.md) says plainly what that means.

---

## Fix it yourself first, in about a minute

Four things account for most of what gets reported, and all four are faster to
try than to describe.

### 1. Reload the extension

`chrome://extensions` → the reload arrow on the QA Wrap card.

Chrome caches the service worker inside the browser profile and will keep
running the old one after an update. The symptom is specific and misleading:
**some** things work and others answer nothing at all, usually with *"the message
port closed before a response was received"* in the console. It is not a
crash and it is not your profile. It is yesterday's backend talking to today's
interface. This has cost this project two separate afternoons; it is a known MV3 trap: reload the extension and reopen the page.

### 2. Reload the page you are testing

Content scripts only inject when a page loads. A tab that was already open when
you installed or reloaded the extension has none, and every page-scoped tool will
politely tell you to reload. That message is literal, not generic.

### 3. Check it is awake

The extension records nothing until you wake it, **per browser window**. A second
window is a second decision. If every tool is greyed out, that is the switch, and
the card at the top of the popup says so.

### 4. Look at the worker's own console

`chrome://extensions` → **Inspect views: service worker**. It opens onto a
banner with the build number, what it currently thinks is happening, and a
`qaw` handle you can type into:

```js
qaw.state()      // what the worker thinks is happening
qaw.sessions()   // every session it has stored
qaw.used()       // which tools this session has used
qaw.handlers()   // every message it answers to
qaw.wake()       // arm the current window without the popup
```

If `qaw.about.build` is not the version on the extensions card, go back to step 1.
Builds before 3.1.0 called the same handle `njb`, and it still answers to that.

---

## Reporting something

Write to naderalzghoulbusiness@gmail.com, or reach the maintainer however you already do.
There is no ticket system inside the product: nothing is uploaded, so there is
nothing for one to read.

**What makes a report actionable**, in rough order of how much time each saves:

1. **The build.** `qaw.about.build` in the worker console, or the number on the
   extensions card.
2. **The browser and version.** Firefox and Safari genuinely cannot do some of
   this (see *Known limits* below), and knowing which one you are on is the
   difference between a bug and an expected refusal.
3. **What you pressed, and what happened instead.** "Nothing happened" is a real
   and useful answer; say it plainly rather than guessing at a cause.
4. **Anything in the two consoles**: the worker's, and the page's.
5. **A session export**, if the problem is about a report rather than a control.
   Report → Raw export → JSON. It contains no cookie values and no passwords, by
   construction, but read it before sending: it does contain the URLs you
   visited and the values you typed into non-password fields.

**Please do not send a token, a webhook URL or a cookie value.** Nothing here
ever needs one to reproduce a bug, and a credential in a message is a credential
you now have to rotate.

---

## Known limits, so you do not report them as bugs

These are decisions, and each one is explained where it lives in the code.

| | |
|---|---|
| **Firefox and Safari cannot record, stitch a full page, make a GIF, or measure coverage** | Those need `chrome.offscreen`, `tabCapture`, `desktopCapture` and `debugger`, which are Chromium-only. The buttons are disabled and name the browser rather than failing when pressed. |
| **No WebKit or Firefox is launched from the extension** | An extension cannot start a process. The session exports as a runnable Playwright project instead, where the real engines exist. |
| **Branch coverage is not reported** | V8 block coverage cannot tell an unexecuted `else` from an unexecuted early return, and a number that is nearly branch coverage gets quoted as branch coverage. |
| **A recording will not start on a tab you have not just used the extension on** | Chrome's protection, not ours. Click the QA Wrap icon while that tab is in front, then press Record. |
| **The QA Wrap bar is hidden while a bare video is fullscreen** | A fullscreen `<video>`, `<audio>` or image has no room for children, so the bar cannot sit inside it. Leave fullscreen and it is back. |
| **The first request on a page may escape a rule** | Rules reach the page a few milliseconds after `document_start`. Inherent to the platform. |

---

## Nothing is uploaded, so nothing can be looked up

There is no telemetry, no crash reporting and no account. That is the point of
the product, and it has one consequence for support worth stating: **nobody can
look up what happened on your machine.** Whatever you send is all there is, which
is why the list above asks for as much as it does.

---

## If you are picking this up from the previous maintainer

Everything needed to work on it is in the repository:

- `README.md`: what each feature is and why it is shaped that way
- `ARCHITECTURE.md`: the architecture and the platform traps
- `npm test`: every suite in `tools/run-suites.mjs`, with no browser
- `node tools/clickthrough.mjs`: presses every button
- `node tools/diagnose.mjs`: runs against the real database and current worker

Read `mv3-traps.md` before changing anything. Every entry in it cost real time.
