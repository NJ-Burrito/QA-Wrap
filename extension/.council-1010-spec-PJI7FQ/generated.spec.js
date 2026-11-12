// ◈ QA Wrap · © 2026 Nader Alzghoul. Released under the MIT licence.
// qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJOYWRlciBBbHpnaG91bCIsInYiOm51bGwsImsiOiJwbGF5d3JpZ2h0LXNwZWMiLCJzIjoic19td2Rodm84aV9hY3BkeTUiLCJ0IjoxNzk0NDg0NzM2fQ.cdf060eb

import { test, expect } from '@playwright/test';

test('capture range and colour', async ({ page }) => {
  await page.goto('http://127.0.0.1:53819/capture-range-color.html');
  await page.getByRole('slider', { name: 'Volume', exact: true }).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '4');
  await page.getByRole('slider', { name: 'Volume', exact: true }).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '5');
  await page.getByRole('slider', { name: 'Volume', exact: true }).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '6');
  await page.getByRole('slider', { name: 'Volume', exact: true }).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, '7');
  // No assertions: nothing was picked as an expected outcome (Ctrl+Shift+click an element to add one).
});
// Prepared with QA Wrap 3.9.3 · 2026-11-12
