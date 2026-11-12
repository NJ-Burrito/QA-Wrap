// ◈ QA Wrap · © 2026 Nader Alzghoul. Released under the MIT licence.
// qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJOYWRlciBBbHpnaG91bCIsInYiOm51bGwsImsiOiJwbGF5d3JpZ2h0LXNwZWMiLCJzIjoic19td2RqeHdxN19lOWE4ZGMiLCJ0IjoxNzk0NDg4MTk5fQ.9795ce7d

import { test, expect } from '@playwright/test';

test('capture multi-tab', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:53233/capture-second.html');
  const [page2] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Second tab button', exact: true }).click()]);
  await page2.getByRole('button', { name: 'Second click', exact: true }).click();
  // No assertions: nothing was picked as an expected outcome (Ctrl+Shift+click an element to add one).
});
// Prepared with QA Wrap 3.9.3 · 2026-11-12
