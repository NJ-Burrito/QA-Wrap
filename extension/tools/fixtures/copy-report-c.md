# Untitled session

| | |
|---|---|
| Session | `s_mv3uqnf9_ah78lp` |
| Started | 2026-10-11T13:21:32.949Z |
| Duration | 108.2s |
| Start URL | chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.html |
| Viewport | — |
| User agent | — |
| Platform | — |
| Language | — |
| Events | 6 (3 failures) |
| Findings | 3 |
| Problems | 3 |
| Ruleset | v2; 0 known-benign notes hidden, kept in the events |

3 failed requests or errors.

## Correlated failures

Each failure linked back to the action that most plausibly triggered it.

### 1. **POST** /practice/api/save-profile → network error (3ms)

- **Triggered by** `+2.37s` Click **Save profile** _(5ms earlier, high confidence)_
- **Failure** `+2.37s` **POST** /practice/api/save-profile → network error (3ms)
- **Also at this instant** `+2.37s` **console.error** Save profile failed: TypeError: Failed to fetch

### 2. **Uncaught** Uncaught TypeError: Cannot read properties of undefined \(reading ''\) \(chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.js:21:41\)

- **Triggered by** `+106.36s` Click **Apply coupon** _(1ms earlier, high confidence)_
- **Failure** `+106.36s` **Uncaught** Uncaught TypeError: Cannot read properties of undefined \(reading ''\) \(chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.js:21:41\)

```
TypeError: Cannot read properties of undefined (reading '')
    at HTMLButtonElement.<anonymous> (chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.js:21:41)
```

## Steps to reproduce

1. Click Save profile
2. Click Apply coupon

## Tester notes

### Bugs

- `+105.57s` Save says Saved but request fails


## Full timeline

- `+2.37s` Click **Save profile**
- `+2.37s` **POST** /practice/api/save-profile → network error (3ms)
- `+2.37s` **console.error** Save profile failed: TypeError: Failed to fetch
- `+105.57s` 📝 Save says Saved but request fails
- `+106.36s` Click **Apply coupon**
- `+106.36s` **Uncaught** Uncaught TypeError: Cannot read properties of undefined \(reading ''\) \(chrome-extension://dbdhilacpjeojfnmdbnpcbmohkhgaihn/practice/practice.js:21:41\)

---

_◈ QA Wrap · Nader Alzghoul · s_mv3uqnf9_ah78lp · 2026-10-11 13:21 · © 2026 Nader Alzghoul. Released under the MIT licence. Nothing in this report left the machine._

<!-- qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJBY21lIFRlc3QiLCJ2IjpudWxsLCJrIjoiYnVnLXJlcG9ydCIsInMiOiJzX212M3VxbmY5X2FoNzhscCIsInQiOjE3OTE3MjQ4OTJ9.a8bf2510 · © 2026 Nader Alzghoul. Released under the MIT licence. -->