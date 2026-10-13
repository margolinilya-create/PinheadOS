import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

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


test.describe('Dark mode', () => {
  test('theme toggle switches to dark mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Кнопка темы ищется по роли и подписи: класс уехал в CSS-модуль
    // (`styles['theme-toggle']` → хэш), и селектор по классу перестал совпадать.
    const toggle = page.getByRole('button', { name: /тема/i });
    await toggle.click();

    // HTML should have data-theme="dark"
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');

    // Toggle back
    await toggle.click();
    const themeLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(themeLight).toBe('light');
  });

  test('dark mode persists across navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /тема/i }).click();

    // Navigate to orders. Тему навешивает эффект после монтирования, поэтому
    // ждём атрибут, а не читаем его сразу после goto — иначе гонка.
    await page.goto('/orders');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
      .toBe('dark');
  });
});
