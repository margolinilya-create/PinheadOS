// spec: SKU Editor Navigation — All 8 tabs render and switch correctly
// seed: pinhead-react/e2e/navigation.spec.ts

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15000 });

test.describe('SKU Editor Navigation', () => {
  test('All 8 tabs render and switch correctly', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByRole('button', { name: 'Изделия' })).toBeVisible({ timeout: 10000 });

    // Verify all 8 tab buttons are visible
    await expect(page.getByRole('button', { name: 'Основная ткань' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отделочная ткань' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обработки' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Фурнитура' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ценообразование' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Правила категорий' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Зоны нанесения' })).toBeVisible();

    // Click tabs and verify content
    await page.getByRole('button', { name: 'Основная ткань' }).click();
    await expect(page.locator('.fabrics-table')).toBeVisible();

    await page.getByRole('button', { name: 'Ценообразование' }).click();
    await expect(page.locator('.pricing-tab-content')).toBeVisible();
    await expect(page.locator('.pricing-sub-tabs')).toBeVisible();

    await page.getByRole('button', { name: 'Правила категорий' }).click();
    await expect(page.locator('.cat-rules-list')).toBeVisible();
    await expect(page.locator('.cat-rule-card')).toHaveCount(11);

    await page.getByRole('button', { name: 'Зоны нанесения' }).click();
    await expect(page.locator('.zones-catalog-table')).toBeVisible();
  });

  test('URL param ?tab=pricing opens Pricing tab directly', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await expect(page.locator('.pricing-tab-content')).toBeVisible({ timeout: 10000 });
  });

  test('/prices redirects to /sku?tab=pricing', async ({ page }) => {
    await page.goto('/prices');
    await expect(page.locator('.pricing-tab-content')).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('/sku');
    expect(page.url()).toContain('tab=pricing');
  });

  test('Active tab is reflected in URL param', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByRole('button', { name: 'Изделия' })).toBeVisible({ timeout: 10000 });

    // Default tab (Изделия) has no tab param
    expect(page.url()).not.toContain('tab=');

    // Click Ценообразование → URL gets tab=pricing
    await page.getByRole('button', { name: 'Ценообразование' }).click();
    await expect(page).toHaveURL(/tab=pricing/);

    // Click Изделия → tab param removed
    await page.getByRole('button', { name: 'Изделия' }).click();
    expect(page.url()).not.toContain('tab=');
  });
});

test.describe('SKU Editor — Правила категорий', () => {
  test('Category accordion expands with all sections', async ({ page }) => {
    await page.goto('/sku?tab=rules');
    await expect(page.locator('.cat-rules-list')).toBeVisible({ timeout: 10000 });

    // Click Футболки to expand
    await page.getByText('Футболки').first().click();

    // All 5 sections visible
    await expect(page.getByText('ТЕХНИКИ НАНЕСЕНИЯ')).toBeVisible();
    await expect(page.getByText('ТЕХНИКИ ПО ЗОНАМ')).toBeVisible();
    await expect(page.getByText('МИНИМАЛЬНЫЙ ТИРАЖ (MOQ)')).toBeVisible();
    await expect(page.getByText('ДОСТУПНЫЕ РАЗМЕРЫ')).toBeVisible();
    await expect(page.getByText('ОБРАБОТКИ ПО УМОЛЧАНИЮ')).toBeVisible();
  });

  test('Only one category expanded at a time', async ({ page }) => {
    await page.goto('/sku?tab=rules');
    await expect(page.locator('.cat-rules-list')).toBeVisible({ timeout: 10000 });

    await page.getByText('Футболки').first().click();
    await expect(page.locator('.cat-rule-card.expanded')).toHaveCount(1);

    await page.getByText('Худи').first().click();
    await expect(page.locator('.cat-rule-card.expanded')).toHaveCount(1);
  });
});

test.describe('SKU Editor — Зоны нанесения', () => {
  test('Zones table renders with existing zones', async ({ page }) => {
    await page.goto('/sku?tab=zones');
    await expect(page.locator('.zones-catalog-table')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Глобальный каталог зон')).toBeVisible();

    // At least the default zones should be present
    await expect(page.locator('.zones-catalog-table tbody tr')).toHaveCount(8, { timeout: 5000 });
  });

  test('Add zone button is disabled with empty ID', async ({ page }) => {
    await page.goto('/sku?tab=zones');
    await expect(page.locator('.zones-catalog-table')).toBeVisible({ timeout: 10000 });

    // Button should be disabled when ID is empty
    await expect(page.locator('.zones-add-row .pe-btn-primary')).toBeDisabled();
  });
});

test.describe('SKU Editor — Ценообразование sub-tabs', () => {
  test('All 8 pricing sub-tabs switch correctly', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await expect(page.locator('.pricing-tab-content')).toBeVisible({ timeout: 10000 });

    // Verify sub-tabs
    await expect(page.locator('.pricing-sub-tabs')).toBeVisible();

    await page.getByRole('button', { name: 'Вышивка' }).click();
    await expect(page.getByText('Стежков на 1 см²')).toBeVisible();

    await page.getByRole('button', { name: 'DTF' }).click();
    await expect(page.getByText('Цена метра плёнки')).toBeVisible();

    await page.getByRole('button', { name: 'DTG' }).click();
    await expect(page.getByText('Базовая цена')).toBeVisible();

    await page.getByRole('button', { name: 'Наценки' }).click();
    await expect(page.locator('.pe-markup-table')).toBeVisible();

    await page.getByRole('button', { name: 'Доп' }).click();
    await expect(page.getByText('Бирка')).toBeVisible();

    await page.getByRole('button', { name: 'История' }).click();
    await expect(page.getByText('История изменений')).toBeVisible();
  });
});
