# QA Wrap terms of service

Published by Nader Alzghoul.

**Effective 5 September 2026.** These terms cover the QA Wrap browser
extension for Chrome, Edge and the Chromium browsers listed in
`README.md`. Installing or using the extension means accepting them.

Two other documents are part of the same agreement and neither is superseded
by this one. `LICENSE` is the MIT licence that covers the software
itself. `PRIVACY.md` sets out what the extension records and where it goes.
Where this file and either of those appear to disagree, the more specific one
governs.

## 1. What you are getting

A browser extension that records a testing session on your own machine and
turns it into evidence: a timeline, the cause of each failure, and the test
documents the ISTQB and ISO/IEC/IEEE 29119-3 shapes name.

There is no QA Wrap account, no QA Wrap server and no subscription. Nothing
here is a hosted service, so there is nothing for Nader Alzghoul to take
away, and nothing that stops working if a server goes down. `SLA.md` explains
which of those guarantees hold because of how the software is built and which
depend on Chrome.

## 2. What you may do with it

`LICENSE` is the whole answer and it is short: the software is released under
the MIT licence. You may use, copy, modify, merge, publish, distribute,
sublicense and sell copies, provided the copyright and permission notice stay
with them. Third-party components keep their own licences
(`THIRD-PARTY-NOTICES.md`).

**Deploying inside your organisation.** An organisation that received a copy
from Nader Alzghoul may, at no charge, deploy that copy to its own staff
through its own tooling or a private store listing, may mirror it and pin a
version (hold at the previous release). Nothing needs permission beyond the
MIT licence itself.

## 3. What you produce with it belongs to you

Your reports, defect records, screenshots, recordings, test cases and exports
are yours. Nader Alzghoul has no claim on them, no copy of them and no way
to reach them: they are written to your browser profile and to folders you
choose.

The one obligation attached to output is attribution of the tool. Generated
artefacts carry an attribution notice and a provenance token, and removing or
falsifying that mark, or presenting QA Wrap's output as another tool's, is a
bad faith toward the people who read your report. Keep the mark: it is how a
reader learns where a file came from. This is about crediting the tool, not
about owning the findings.

## 4. What you are responsible for

You choose what to test and what to record. That makes a few things yours to
get right, and the extension gives you the controls for each:

1. **Permission to test the site.** QA Wrap works on whatever site you point
   it at, including sites you do not own. Having the technical ability to
   record a site is not authorisation to test it.
2. **The personal data you capture.** Testing happens on systems full of real
   people's records. Masking, redaction and a retention window are in Settings,
   documented in `PRIVACY.md`, and it is your decision whether to use them.
   Under GDPR you are the controller for anything you record; Nader Alzghoul
   is not a processor of it, because none of it reaches Nader Alzghoul.
3. **Where you send it.** Jira, Slack, Teams, Discord, Google Chat, GitHub,
   Linear, Trello, ClickUp and Asana are opt-in, configured by you, and
   nothing is sent until you press a button naming the destination. Once a
   report leaves for one of them, that service's terms apply to it and this
   one no longer can.
4. **The tokens you paste.** A tracker token stored in your browser profile is
   readable by anyone with access to that profile. Scope it to what it needs
   and revoke it when you are done.

## 5. What the extension will not do

These are commitments, and `PRIVACY.md` documents the mechanism behind each:

- It makes no network request of its own. No analytics, no telemetry, no
  update ping, no remote code.
- It does not record password fields or cookie values into a session or an
  export. Saved cookie profiles are the exception: they hold the values you
  saved, on your machine, until you delete them.
- It records nothing and acts on nothing in a browser window you have not woken,
  including through the right-click menu and the keyboard shortcuts. On a site
  you have allowed, its page scripts stay loaded.

## 6. No warranty, and the limit of liability

The software is provided as is, without warranty of any kind, express or
implied, including merchantability, fitness for a particular purpose and
non-infringement. `LICENSE` states this in full and is the operative text.

QA Wrap reports what a browser and a page did during your session. It is
evidence for a human judgement, and it is not a certification, an audit, or a
guarantee that software is correct or accessible. An automated accessibility
scan finds roughly a third of real barriers, and the extension says so on the
screen that runs one. Decisions you take on the strength of a report are
yours.

To the extent the law allows, Nader Alzghoul is not liable for lost data,
lost work, lost profit, or any indirect or consequential loss arising from the
use of the extension. Sessions live in a browser profile: if the profile is
deleted, they are gone, so export what matters.

Nothing in these terms limits liability that cannot be limited by law, which
in most jurisdictions includes death or personal injury caused by negligence,
and fraud.

## 7. Changes, and ending it

Changes to these terms are recorded in the extension's release notes, the same
way changes to the privacy policy are. A material change is described there in
plain words rather than by a version bump alone.

You can stop at any time by uninstalling the extension, which removes its
database and its settings from that browser profile. Files you already
exported to disk are untouched, because they are yours.

The MIT licence is not revocable. There is no remote switch, and the software
never stops running because of anything Nader Alzghoul does.

## 8. Governing law and contact

These terms are governed by the law of the Hashemite Kingdom of Jordan, and
its courts have jurisdiction. If you are a consumer, this does not remove the
protections of the law where you live.

Questions about these terms, and any permission not granted above, go to
Nader Alzghoul through `SUPPORT.md` in the package.
