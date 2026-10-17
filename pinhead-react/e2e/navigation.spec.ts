// E2E smoke tests: navigation between core routes

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

test.describe('Core navigation', () => {
  test('/ ведёт в список заказов, «Новый заказ» в меню — кнопка', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sales$/);
    await expect(page.getByRole('heading', { name: 'Все заказы' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Разделы заказа' });
    await expect(nav.getByRole('button', { name: 'Новый заказ' })).toBeVisible();
  });

  test('express calculator route loads', async ({ page }) => {
    await page.goto('/express');
    // Any element with text EXPRESS or КАЛЬКУЛЯТОР appears in header
    await expect(page.getByText(/EXPRESS|КАЛЬКУЛЯТОР/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('старые адреса ведут на рабочие экраны', async ({ page }) => {
    // Все старые адреса раздела — в список заказов (веха 3)
    for (const old of ['/orders', '/print', '/analytics']) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/sales$/);
      await expect(page.getByRole('heading', { name: 'Все заказы' })).toBeVisible({ timeout: 10000 });
    }
  });
});
