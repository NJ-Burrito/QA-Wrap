// ◈ QA Wrap · © 2026 Nader Alzghoul. Released under the MIT licence.
// qaw1:eyJwIjoiUUEgV3JhcCIsIm8iOiJOYWRlciBBbHpnaG91bCIsInYiOm51bGwsImsiOiJwbGF5d3JpZ2h0LXNwZWMiLCJzIjoic19td2RpNWg2bF8zMTQxOWkiLCJ0IjoxNzk0NDg1MTkzfQ.adc834d9

import { test, expect } from '@playwright/test';

test('capture spec run', async ({ page }) => {
  await page.goto('http://127.0.0.1:56579/capture-spec.html');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sara');
  // FIXME: secret field. Set QAW_SECRET_INPUT (or UQA_SECRET for every secret field); the value was never recorded.
  await page.getByLabel('Password').fill(process.env.QAW_SECRET_INPUT ?? process.env.UQA_SECRET ?? '');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toHaveText('Saved');
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await page.goBack();
  await page.reload();
});
// Prepared with QA Wrap 3.9.3 · 2026-11-12
