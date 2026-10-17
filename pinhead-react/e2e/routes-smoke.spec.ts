// E2E smoke tests: routes that had zero coverage
// Covers: /admin, /prices, /sku, перенаправления /analytics и /print

import { test, expect } from '@playwright/test';

/**
 * Онбординг-тур (`OnboardingTips`) в свежем профиле накрывает страницу
 * `.onboarding-backdrop` и перехватывает клики. В e2e профиль всегда чистый,
 * поэтому гасим тур до загрузки страницы — иначе падает любой сценарий визарда.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('ph_onboarding_done', '1'); } catch { /* приватный режим */ }
  });
});


test.use({ actionTimeout: 10000 });

test.describe('Admin panel', () => {
  test('loads user management interface', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByText(/Пользователи|Администрирование|Управление/i).first()).toBeVisible({ timeout: 10000 });
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

test.describe('Убранные адреса', () => {
  test('/analytics и /print ведут в список заказов', async ({ page }) => {
    for (const old of ['/analytics', '/print']) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/sales$/);
      await expect(page.getByRole('heading', { name: 'Все заказы' })).toBeVisible({ timeout: 10000 });
    }
  });
});
