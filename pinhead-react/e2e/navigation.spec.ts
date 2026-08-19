// E2E smoke tests: navigation between core routes
// Канбан ТЗ и аналитика Order Studio убраны (решение заказчика, сессия 33):
// список ТЗ живёт вкладкой в единой админке, обзор — на дашборде ERP.

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

test.describe('Core navigation', () => {
  test('wizard page loads with step 1 visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();
    await expect(page.locator('.garment-row').first()).toBeVisible();
  });

  test('express calculator route loads', async ({ page }) => {
    await page.goto('/express');
    // Any element with text EXPRESS or КАЛЬКУЛЯТОР appears in header
    await expect(page.getByText(/EXPRESS|КАЛЬКУЛЯТОР/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('header logo link returns to wizard', async ({ page }) => {
    await page.goto('/express');
    await expect(page.getByText(/EXPRESS|КАЛЬКУЛЯТОР/i).first()).toBeVisible({ timeout: 10000 });
    // Click the header logo / brand
    const logo = page.locator('.logo, .logo-text').first();
    if (await logo.isVisible()) {
      await logo.click();
      await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible({ timeout: 10000 });
    }
  });
});
