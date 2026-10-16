// E2E smoke tests: navigation between core routes

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

  test('старые адреса ведут на рабочие экраны', async ({ page }) => {
    // Dev-вход — admin: /orders → список заказов v4, остальные → визард
    await page.goto('/orders');
    await expect(page).toHaveURL(/\/sales$/);
    for (const old of ['/print', '/analytics']) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible({ timeout: 10000 });
    }
  });
});
