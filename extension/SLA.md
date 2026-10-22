# Service level

**QA Wrap**, published and maintained by Nader Alzghoul. Version 3.5.3.

---

## Read this first

A service level agreement is a commitment somebody can be held to. Publishing
one that cannot be met is worse than publishing none, because a team will plan
around it.

**This is a single-maintainer tool with no funded company support behind it and
no paid support.** Nader Alzghoul owns and publishes it (see `LICENSE`); it
is offered free, with no service commitment beyond this page. So what follows is deliberately in two parts: the things that are
*guaranteed by construction*, meaning they hold because of how the software is
built rather than because anyone promises to be available, and the things that depend on one
person's time, which are stated as intentions with the honest caveat attached.

If your organisation needs a contractual SLA, the tools compared in the
benchmark report have one and this does not. That is a real reason to choose
them, and it is not a criticism of them.

---

## Guaranteed by construction

These hold whether or not anybody answers an email, because they are properties
of the code. Each is asserted by a test that runs on every change, and the test
is named.

| Guarantee | Why it holds | Asserted by |
|---|---|---|
| **Nothing leaves your machine unless you press a button that names where it is going** | There is no telemetry, no analytics and no phone-home. The only outbound calls are Jira, the five trackers and chat destinations you configure yourself. | `test-notify.mjs`, `test-trackers.mjs`, `diagnose.mjs` |
| **No cookie value and no password ever reaches an artefact** | The recorder masks password fields at capture; `safeCookies()` records names and flags only; the request recorder redacts credential-shaped keys before storage. | `test-istqb.mjs`, `test-postman.mjs`, `diagnose.mjs` |
| **The extension is inert until you wake it, per window** | Every capability is refused at the message seam, and the two non-message routes (the right-click menu and keyboard shortcuts) are gated at their own seams. | `clickthrough.mjs`, `diagnose.mjs` |
| **A session survives the browser killing the background worker** | No state is held in memory; every event is written to IndexedDB as it arrives. | `stress.mjs` |
| **Nothing recorded is lost under load** | 20,000 events stored with zero loss, and a 2,000-request burst kept in order. | `stress.mjs` |
| **A generated document never presents a guess as a fact** | Derived expected results are marked, a case built from a failing run asks to be reviewed, and severity and priority stay labelled as suggestions until chosen. | `test-istqb.mjs`, `test-suite.mjs` |
| **Your data is yours and portable at any moment** | Fourteen export formats, all local. Uninstalling loses nothing you have exported. | `test-exporters.mjs` |

**How to check any of these yourself:** `npm test` runs every assertion above
with no browser and no network, in seconds. You do not have to take this page's
word for it.

---

## Depends on one person

Stated as intentions, because that is what they are.

| | Intention | The honest caveat |
|---|---|---|
| **Acknowledgement** | Within a few working days | One person, one timezone, and other work |
| **A bug that loses recorded data** | Treated as the highest priority there is | The only class of bug that would justify dropping everything |
| **A bug that blocks a feature entirely** | Next release | "Next release" is not a date |
| **Anything cosmetic or an enhancement** | The roadmap, or never | See [ROADMAP.md](ROADMAP.md) |
| **A security issue** | Same day if it is reachable from a page | Report it privately, not in a shared channel |
| **Availability** | None promised | There is no on-call and no rota |

---

## What is explicitly not offered

Saying this plainly is more useful than leaving it to be discovered.

- **No uptime commitment**, because there is nothing hosted to be up. The
  extension runs entirely in your browser.
- **No data recovery.** Nobody has a copy of your sessions. If you clear the
  browser profile, they are gone. Export what matters.
- **No paid tier, and no support contract.**
- **No guaranteed compatibility with a future Chrome.** MV3 is still moving. The
  test suite is the early-warning system, and `diagnose.mjs` runs against the
  real database precisely so a platform change is caught rather than reported.
- **No promise that the roadmap will be delivered.** It is a list of intentions
  in priority order, and it says so.

---

## If Nader Alzghoul stops maintaining it

- **The extension keeps working.** Nothing calls home, so nothing breaks when a
  server goes away, because there is no server.
- **The last-known-good build stays installable by ID.** The extension ID is
  `dbdhilacpjeojfnmdbnpcbmohkhgaihn`; an organisation that has mirrored and
  pinned a version (`LICENSE` clause 2A) keeps installing that exact copy for
  as long as its browser accepts it.
- **What stops** is new releases: no fixes, no adaptation to a future Chrome.
  The notice will be a final release note and a line on the support page.
- **Your data is already yours.** Exports are local files; nothing needs
  Nader Alzghoul to read them.

---

## Severity, in this project's own vocabulary

The same two axes the product itself insists on, because a support page that
collapsed them would contradict the tool.

**Severity** is the impact. **Priority** is the urgency. They are set separately.

| Severity | Means | Example |
|---|---|---|
| **Critical** | Recorded evidence is lost or corrupted | A session that stops writing events mid-run |
| **Major** | A feature does not work at all | Every tool button dead, which happened, in 1.9.0 |
| **Moderate** | A feature works but reports the wrong thing | Layout stress reporting "restored" in both directions |
| **Minor** | Cosmetic, or an edge case with a workaround | A stretched status pip |

A **critical** severity is not automatically the highest priority, and the
product's own documentation is emphatic about why: a crash in something nobody
runs until December is critical severity and low priority until December.

---

## Reporting a security issue

Privately, to the maintainer, not in a shared channel and not in a ticket anybody can
read.

The realistic surface is small and worth knowing: the extension holds
`<all_urls>`, patches `fetch` and `XMLHttpRequest` in every page, and can read
cookies. It records nothing until armed, per window, and goes back to inert when the
browser closes. The thing genuinely worth reporting is **anything that acts while
the extension is asleep**. That is the boundary the whole design rests on, and
two ways past it have already been found and closed.
