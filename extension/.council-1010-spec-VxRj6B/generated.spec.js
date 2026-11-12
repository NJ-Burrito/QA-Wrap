// ◈ QA Wrap · © 2026 Nader Alzghoul. Released under the MIT licence.
// qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJOYWRlciBBbHpnaG91bCIsInYiOm51bGwsImsiOiJwbGF5d3JpZ2h0LXNwZWMiLCJzIjoic19td2RodTk4aV9uN2s0MWwiLCJ0IjoxNzk0NDg0NjcwfQ.2d8b37f6

import { test, expect } from '@playwright/test';

test('capture multi-tab', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:53819/capture-second.html');
  const [page2] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Second tab button', exact: true }).click()]);
  await page2.getByRole('button', { name: 'Second click', exact: true }).click();
  // No assertions: nothing was picked as an expected outcome (Ctrl+Shift+click an element to add one).
});
// Prepared with QA Wrap 3.9.3 · 2026-11-12
