# POST /api/save-profile 500

| | |
|---|---|
| Session | `s_mvs1f11z_b0ppsc` |
| Started | 2026-10-28T11:34:56.279Z |
| Duration | 5.5s |
| Start URL | chrome-extension://nddoikfgkifleiinfencobbagpmpaoko/practice/practice.html |
| Events | 14 |
| Findings | 2 |
| Problems | 2 |
| Ruleset | v2; 0 known-benign notes hidden, kept in the events |

2 failed requests or errors.

## Correlated failures

Each failure linked back to the action that most plausibly triggered it.

### 1. **POST** /api/save-profile → 500 (2ms)

- **Triggered by** `+1.24s` Click **Save profile** _(3ms earlier, high confidence)_
- **Failure** `+1.24s` **POST** /api/save-profile → 500 (2ms)

```
{"ok":false,"error":"save failed"}
```

### 2. **Uncaught** Uncaught TypeError: Cannot read properties of undefined (reading 'SAVE10') (chrome-extension://nddoikfgkifleiinfencobbagpmpaoko/practice/practice.html:1:1)

- **Triggered by** `+2.88s` Click **Apply** _(3ms earlier, high confidence)_
- **Failure** `+2.89s` **Uncaught** Uncaught TypeError: Cannot read properties of undefined (reading 'SAVE10') (chrome-extension://nddoikfgkifleiinfencobbagpmpaoko/practice/practice.html:1:1)

```
TypeError: Cannot read properties of undefined (reading 'SAVE10')
    at HTMLDivElement.onClick (chrome-extension://nddoikfgkifleiinfencobbagpmpaoko/game/levels/l2.js:99:19)
```

## Steps to reproduce

1. Click Start
2. Click Go
3. Click Save profile
4. Click Skip level
5. Click Next level
6. Click Go
7. Fill Coupon with `SAVE10`
8. Click Apply

## Full timeline

- `+0.11s` Click **Start**
- `+0.18s` **GET** /game/audio/en/v01.ogg → 200 (61ms)
- `+0.70s` Click **Go**
- `+1.24s` Click **Save profile**
- `+1.24s` **POST** /api/save-profile → 500 (2ms)
- `+1.27s` Click **Skip level**
- `+1.55s` **GET** /game/audio/en/v07.ogg → 200 (4ms)
- `+1.58s` **GET** /game/audio/en/v08.ogg → 200 (15ms)
- `+1.80s` Click **Next level**
- `+1.83s` **GET** /game/audio/en/v03.ogg → 200 (16ms)
- `+2.34s` Click **Go**
- `+2.59s` Fill **Coupon** with `SAVE10`
- `+2.88s` Click **Apply**
- `+2.89s` **Uncaught** Uncaught TypeError: Cannot read properties of undefined (reading 'SAVE10') (chrome-extension://nddoikfgkifleiinfencobbagpmpaoko/practice/practice.html:1:1)

---

_◈ QA Wrap · Nader Alzghoul · s_mvs1f11z_b0ppsc · 2026-10-28 11:34 · © 2026 Nader Alzghoul. Released under the MIT licence. https://nj-burrito.github.io/QA-Wrap/ Nothing in this report left the machine._

<!-- qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJOYWRlciBBbHpnaG91bCIsInYiOm51bGwsImsiOiJidWctcmVwb3J0IiwicyI6InNfbXZzMWYxMXpfYjBwcHNjIiwidCI6MTc5MzE4NzI5Nn0.9c65b6be · © 2026 Nader Alzghoul. Released under the MIT licence. -->