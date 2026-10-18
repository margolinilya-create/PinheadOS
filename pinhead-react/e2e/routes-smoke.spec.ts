// E2E smoke tests: routes that had zero coverage
// Covers: /admin, /prices, /sku, перенаправления /analytics и /print

import { test, expect, type Page } from '@playwright/test';

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
    await expect(page.getByRole('tablist', { name: 'Разделы прайса' })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('SKU editor', () => {
  const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

  test('loads with SKU catalog tabs', async ({ page }) => {
    await page.goto('/sku');
    await expect(tab(page, 'Изделия')).toBeVisible({ timeout: 10000 });
    await expect(tab(page, 'Основная ткань')).toBeVisible();
  });

  test('can switch between tabs', async ({ page }) => {
    await page.goto('/sku');
    await expect(tab(page, 'Изделия')).toBeVisible({ timeout: 10000 });

    await tab(page, 'Основная ткань').click();
    await expect(page.getByRole('region', { name: 'Основные ткани' })).toBeVisible();

    await tab(page, 'Отделочная ткань').click();
    await expect(page.getByRole('region', { name: 'Отделочные ткани' })).toBeVisible();

    await tab(page, 'Обработки').click();
    await expect(page.getByText(/Обработок:/)).toBeVisible();

    await tab(page, 'Фурнитура').click();
    await expect(page.getByRole('tabpanel').getByRole('heading', { level: 2 }).first()).toBeVisible();
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
