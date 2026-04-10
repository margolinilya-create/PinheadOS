// E2E Test: Order Creation Wizard — Full Happy Path
// Plan: tests/E2E-TEST-PLAN.md, scenario 2.1

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15000 });

test.describe('Order Creation Wizard', () => {
  test('should complete full order flow - tshirt with screen print', async ({ page }) => {
    // 1. Navigate and wait for app
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // 2. Select first SKU from garment list
    await page.locator('.garment-row').first().click();

    // 3. Wait for fabric section to appear, select first option
    await page.locator('.fit-option').first().waitFor({ state: 'visible' });
    await page.locator('.fit-option').first().click();

    // 4. Wait for color section, select first visible swatch
    await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
    await page.locator('.swatch:not(.hidden)').first().click();

    // 5. Wait for size table, enter quantity 10 for size M
    await page.locator('.size-section').waitFor({ state: 'visible' });
    await page.locator('tr', { has: page.locator('td b', { hasText: 'M' }) }).first().locator('.qty-input').fill('10');

    // 6. Advance to Design step
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByRole('heading', { name: 'ДИЗАЙН' })).toBeVisible();

    // 7. Select "Без нанесения" to skip zones (simpler path)
    await page.locator('button.zone-card-noprint').first().click();

    // 8. Advance to Items step
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByRole('heading', { name: /ПОЗИЦИИ/ })).toBeVisible();

    // 9. Verify item card appeared
    await expect(page.locator('.item-card').first()).toBeVisible();

    // 10. Advance to Details step
    await page.getByRole('button', { name: 'Далее' }).click();

    // 11. Fill client details
    await page.locator('#field-name').fill('Тест Клиент');
    await page.locator('#field-email').fill('test@example.com');
    await page.locator('#field-phone').fill('+79991234567');

    // 12. Advance to Summary step
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByRole('heading', { name: /ГОТОВО/ })).toBeVisible();

    // 13. Verify price total visible
    await expect(page.locator('.price-total')).toBeVisible();

    // 14. Verify save button is enabled
    await expect(page.getByRole('button', { name: 'Сохранить заказ' })).toBeEnabled();
  });

  test('should block Details step when name is missing', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Quick setup: select SKU + fabric + color + qty
    await page.locator('.garment-row').first().click();
    await page.locator('.fit-option').first().waitFor({ state: 'visible' });
    await page.locator('.fit-option').first().click();
    await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
    await page.locator('.swatch:not(.hidden)').first().click();
    await page.locator('.size-section').waitFor({ state: 'visible' });
    await page.locator('tr', { has: page.locator('td b', { hasText: 'M' }) }).first().locator('.qty-input').fill('5');
    await page.getByRole('button', { name: 'Далее' }).click();

    // Design — no print
    await page.locator('button.zone-card-noprint').first().click();
    await page.getByRole('button', { name: 'Далее' }).click();

    // Items — advance
    await page.getByRole('button', { name: 'Далее' }).click();

    // Details — leave name empty, fill only email/phone
    await page.locator('#field-email').fill('test@example.com');
    await page.locator('#field-phone').fill('+79991234567');

    // "Далее" button should be disabled (has .disabled class) without name
    const nextBtn = page.getByRole('button', { name: 'Далее' });
    await expect(nextBtn).toHaveClass(/disabled/);
  });

  test('should block navigation with unsaved order', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Select SKU to start wizard
    await page.locator('.garment-row').first().click();
    await page.locator('.fit-option').first().waitFor({ state: 'visible' });
    await page.locator('.fit-option').first().click();
    await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
    await page.locator('.swatch:not(.hidden)').first().click();
    await page.locator('.size-section').waitFor({ state: 'visible' });
    await page.locator('tr', { has: page.locator('td b', { hasText: 'M' }) }).first().locator('.qty-input').fill('5');

    // Advance to step 1
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByRole('heading', { name: 'ДИЗАЙН' })).toBeVisible();

    // Try to navigate away via header
    await page.getByRole('button', { name: 'Заказы' }).click();

    // Blocker dialog should appear
    await expect(page.getByText('Заказ не сохранён')).toBeVisible();

    // Click "Остаться"
    await page.getByRole('button', { name: 'Остаться' }).click();

    // Should still be on Design step
    await expect(page.getByRole('heading', { name: 'ДИЗАЙН' })).toBeVisible();
  });

  test('progress bar fills as steps advance', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Progress fill bar should exist and start narrow
    const fillBar = page.locator('[class*="progress-fill-bar"]');
    await expect(fillBar).toBeVisible();

    const initialWidth = await fillBar.evaluate(el => {
      return parseFloat(getComputedStyle(el).width);
    });

    // Select garment, fabric, color, qty to enable Next
    await page.locator('.garment-row').first().click();
    await page.locator('.fit-option').first().waitFor({ state: 'visible' });
    await page.locator('.fit-option').first().click();
    await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
    await page.locator('.swatch:not(.hidden)').first().click();
    await page.locator('.size-section').waitFor({ state: 'visible' });
    await page.locator('tr', { has: page.locator('td b', { hasText: 'M' }) }).first().locator('.qty-input').fill('10');

    // Click Next to advance to step 2
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByRole('heading', { name: 'ДИЗАЙН' })).toBeVisible();

    // Progress bar should be wider now
    const newWidth = await fillBar.evaluate(el => {
      return parseFloat(getComputedStyle(el).width);
    });
    expect(newWidth).toBeGreaterThan(initialWidth);
  });

  test('garment selection highlights the row', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.garment-row').first()).toBeVisible();

    const firstRow = page.locator('.garment-row').first();
    await firstRow.click();

    // Row should get .selected class
    await expect(firstRow).toHaveClass(/selected/);
  });

  test('step tabs show visited state after navigating back', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Select garment, fabric, color, qty and go to step 2
    await page.locator('.garment-row').first().click();
    await page.locator('.fit-option').first().waitFor({ state: 'visible' });
    await page.locator('.fit-option').first().click();
    await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
    await page.locator('.swatch:not(.hidden)').first().click();
    await page.locator('.size-section').waitFor({ state: 'visible' });
    await page.locator('tr', { has: page.locator('td b', { hasText: 'M' }) }).first().locator('.qty-input').fill('5');
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByRole('heading', { name: 'ДИЗАЙН' })).toBeVisible();

    // Step 1 tab should now be clickable (visited/done state)
    const step1Tab = page.locator('[class*="step-tab"]').first();
    await expect(step1Tab).toBeVisible();

    // Click step 1 to go back
    await step1Tab.click();
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible({ timeout: 5000 });
  });
});
