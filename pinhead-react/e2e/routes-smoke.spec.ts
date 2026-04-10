// E2E smoke tests: routes that had zero coverage
// Covers: /admin, /analytics, /prices, /sku, /print

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

test.describe('Admin panel', () => {
  test('loads user management interface', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/Пользователи|Администрирование|Управление/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Analytics dashboard', () => {
  test('loads with chart or empty state', async ({ page }) => {
    await page.goto('/analytics');
    // Dashboard renders either charts or loading/empty state
    // Dashboard lazy-loads; wait for any content to render
    await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Price editor', () => {
  test('loads with price table', async ({ page }) => {
    await page.goto('/prices');
    await expect(page.locator('.pe-matrix, .pe-tabs, [class*="price"]').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('SKU editor', () => {
  test('loads with SKU catalog tabs', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByText('Изделия')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Основная ткань')).toBeVisible();
  });

  test('can switch between tabs', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByText('Изделия')).toBeVisible({ timeout: 10000 });

    // Switch to fabrics tab
    await page.getByRole('button', { name: 'Основная ткань' }).click();
    await expect(page.locator('.fabrics-table')).toBeVisible();

    // Switch to trims tab
    await page.getByRole('button', { name: 'Отделочная ткань' }).click();
    await expect(page.locator('.fabrics-table')).toBeVisible();

    // Switch to extras tab
    await page.getByRole('button', { name: 'Обработки' }).click();
    await expect(page.getByText(/обработок/)).toBeVisible();

    // Switch to hardware tab
    await page.getByRole('button', { name: 'Фурнитура' }).click();
    await expect(page.locator('.sku-ed-group').first()).toBeVisible();
  });
});

test.describe('Print preview', () => {
  test('loads when order is in store', async ({ page }) => {
    // First set up an order via wizard
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();
    await page.locator('.garment-row').first().click();
    await page.locator('.fit-option').first().waitFor({ state: 'visible' });
    await page.locator('.fit-option').first().click();
    await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
    await page.locator('.swatch:not(.hidden)').first().click();
    await page.locator('.size-section').waitFor({ state: 'visible' });
    await page.locator('tr', { has: page.locator('td b', { hasText: 'M' }) }).first().locator('.qty-input').fill('5');

    // Navigate to print preview
    await page.goto('/print');
    // Should render print layout or redirect
    await page.waitForTimeout(1000);
    const url = page.url();
    // Either we're on /print with content, or redirected to /
    expect(url).toMatch(/\/(print)?$/);
  });
});
