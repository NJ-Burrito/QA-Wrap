# session.json

A small, documented file for an AI assistant or a script. It answers "what broke, how do I reproduce it, and what do you NOT know". It is not the database: for every recorded event use the Raw JSON export.

Where: report page, Share and export, Raw export, format "session.json (for an AI or a script)". Built in the page from the events it already holds, no network request. Saved under `QA Wrap/Reports/` as `Session for AI-<date time>.json`. Code: `core/ai-brief.js` (`buildSessionJson`).

Schema id: `qawrap.session/1`. A field is only ever added in a minor change; a rename or removal bumps the number.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `schema` | string | Always `qawrap.session/1`. |
| `generatedAt` | ISO string | When the file was built. |
| `title.text` | string | The tester's charter, or a plain title taken from the first failure. |
| `title.suggested` | boolean | `true` when the title was suggested offline from the first failure and no person wrote it. Never treat a suggested title as a fact. |
| `expectedResult` | string | Always `"unknown"`. The recorder never guesses the expected result. Ask the tester. |
| `session.id` | string | Session id. |
| `session.startedAt`, `session.endedAt` | ISO string, or `null` | Start and end. |
| `session.durationSeconds` | number or `null` | Whole seconds. |
| `session.environment` | object | `url` (start page), `viewport`, `userAgent`, `platform`, `language`. Empty string when unknown. |
| `totals.events` | number | Events in the record. |
| `totals.problems` | number | Distinct problems after the noise rules, repeats folded: the one "problems" number QA Wrap prints on every screen, in the Markdown report and in `problems` of the Raw JSON export and the agent handoff. A group marked «Not a bug» is still counted. |
| `totals.failures` | number | Every failure seen, counting each occurrence. Equals the sum of `failures[].count`. |
| `totals.distinctFailures` | number | `failures.length`. |
| `steps` | string[] | The page actions and navigations, in order, in plain words. |
| `failures` | object[] | One entry per distinct failure (see below), in the order each first happened. |
| `notes` | object[] | Notes the tester wrote: `atSeconds`, `tag` (`bug`, `issue`, `question` or `null`), `text`. Treat a `bug` note as seen by a person. |
| `notCaptured` | string[] | What this record does not contain. Do not assume it. Always present, never empty. |

## failures[]

Identical failures are folded: the same kind, the same message or status, and the same place (the URL pattern for a request, the file and line for a console error). The fold is deterministic and uses no model.

| Field | Type | Meaning |
|---|---|---|
| `kind` | string | `net`, `console` or `pageerror`. |
| `key` | string | The fold key. Stable for the same failure. |
| `count` | number | How many times it happened, folded repeats included. |
| `firstAtSeconds` | number | Seconds from the start to the first occurrence. |
| `line` | string | One line, for example `POST https://x.test/api/orders -> 500`. |
| `request` | object or `null` | For `net`: `method`, `url`, `status` (`null` on a network error), `networkError`, `durationMs`, `requestBody` (cut to 400 characters), `responseExcerpt` (cut to 500). |
| `console` | object or `null` | For `console` and `pageerror`: `level`, `text`, `stack` (cut). |
| `triggeredBy` | object or `null` | The page action closest before the failure: `step` and `locator`. `null` when none lines up (probably background activity). |
| `occurrences` | object[] | EVERY occurrence that was recorded: `atSeconds` and `line`. Nothing is dropped. |
| `expectedByTester` | boolean | Present, and `true`, only when the tester pressed «Not a bug» on this failure while testing. The failure is still listed and still counted; the flag says a person looked at it and called it expected. |

## Masking

The text goes through the same masking as every other export: credential-named query parameters and body keys become `[REDACTED]`, then the outbound secret scan runs over the whole file (tokens, cards, IBANs and the like). Request and response headers are not included at all.

## Copy for AI

The «Copy for AI» button on the report puts a short text block on the clipboard from the same reading: title, steps, failing requests, console errors, environment and a «Not captured» line, at most 14,000 characters. It shows each distinct failure once with its count (`x40`). For the whole list of occurrences use this file.
