# Untitled session

| | |
|---|---|
| Session | `s_mv3uphrr_yfl7o6` |
| Started | 2026-10-11T13:20:38.967Z |
| Duration | 5.0s |
| Start URL | chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.html |
| Viewport | — |
| User agent | — |
| Platform | — |
| Language | — |
| Events | 4 (2 failures) |
| Findings | 2 |
| Problems | 2 |
| Ruleset | v2; 0 known-benign notes hidden, kept in the events |

2 failed requests or errors.

## Correlated failures

Each failure linked back to the action that most plausibly triggered it.

### 1. **POST** /practice/api/save-profile → network error (3ms)

- **Triggered by** `+2.38s` Click **Save profile** _(6ms earlier, high confidence)_
- **Failure** `+2.39s` **POST** /practice/api/save-profile → network error (3ms)
- **Also at this instant** `+2.39s` **console.error** Save profile failed: TypeError: Failed to fetch

## Steps to reproduce

1. Click Save profile

## Tester notes

### Bugs

- `+4.24s` Save says Saved but fails \(30th bug\)


## Full timeline

- `+2.38s` Click **Save profile**
- `+2.39s` **POST** /practice/api/save-profile → network error (3ms)
- `+2.39s` **console.error** Save profile failed: TypeError: Failed to fetch
- `+4.24s` 📝 Save says Saved but fails \(30th bug\)

---

_◈ QA Wrap · Nader Alzghoul · s_mv3uphrr_yfl7o6 · 2026-10-11 13:20 · © 2026 Nader Alzghoul. Released under the MIT licence. Nothing in this report left the machine._

<!-- qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJBY21lIFRlc3QiLCJ2IjpudWxsLCJrIjoiYnVnLXJlcG9ydCIsInMiOiJzX212M3VwaHJyX3lmbDdvNiIsInQiOjE3OTE3MjQ4Mzh9.4ce30176 · © 2026 Nader Alzghoul. Released under the MIT licence. -->