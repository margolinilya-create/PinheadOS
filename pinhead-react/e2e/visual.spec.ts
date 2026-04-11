import { test, expect } from '@playwright/test';

const pages = [
  { url: '/',          name: 'wizard' },
  { url: '/orders',    name: 'kanban' },
  { url: '/express',   name: 'express' },
  { url: '/sku',       name: 'sku' },
];

// /prices removed — it redirects to /sku?tab=pricing now

for (const { url, name } of pages) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      threshold: 0.15,
    });
  });
}
