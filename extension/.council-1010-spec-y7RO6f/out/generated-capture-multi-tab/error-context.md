# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: generated.spec.js >> capture multi-tab
- Location: generated.spec.js:6:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: browserContext.waitForEvent: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - heading "Second page" [level=1] [ref=e2]
  - button "Second tab button" [active] [ref=e3]
  - status [ref=e4]: clicked in tab two
```

# Test source

```ts
  1  | // ◈ QA Wrap · © 2026 Nader Alzghoul. Released under the MIT licence.
  2  | // qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJOYWRlciBBbHpnaG91bCIsInYiOm51bGwsImsiOiJwbGF5d3JpZ2h0LXNwZWMiLCJzIjoic19td2RpNGpnel90MmgzZHAiLCJ0IjoxNzk0NDg1MTUwfQ.9cdfef5c
  3  | 
  4  | import { test, expect } from '@playwright/test';
  5  | 
  6  | test('capture multi-tab', async ({ page, context }) => {
  7  |   await page.goto('http://127.0.0.1:56579/capture-second.html');
> 8  |   const [page2] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Second tab button', exact: true }).click()]);
     |                                              ^ Error: browserContext.waitForEvent: Test timeout of 30000ms exceeded.
  9  |   await page2.getByRole('button', { name: 'Second click', exact: true }).click();
  10 |   // No assertions: nothing was picked as an expected outcome (Ctrl+Shift+click an element to add one).
  11 | });
  12 | // Prepared with QA Wrap 3.9.3 · 2026-11-12
  13 | 
```