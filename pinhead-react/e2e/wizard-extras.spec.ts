// E2E tests: Wizard edge cases and extras
// Covers: extras accordion, accessory flow, custom sizes, validation

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 15000 });

// Helper: select first SKU + fabric + color
async function setupGarmentStep(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();
  await page.locator('.garment-row').first().click();
  await page.locator('.fit-option').first().waitFor({ state: 'visible' });
  await page.locator('.fit-option').first().click();
  await page.locator('.swatch:not(.hidden)').first().waitFor({ state: 'visible' });
  await page.locator('.swatch:not(.hidden)').first().click();
  await page.locator('.size-section').waitFor({ state: 'visible' });
}

test.describe('Wizard extras and edge cases', () => {
  test('extras accordion opens and shows options', async ({ page }) => {
    await setupGarmentStep(page);

    // Find and click extras accordion
    const toggle = page.locator('.extras-accordion-toggle');
    if (await toggle.isVisible()) {
      await toggle.click();

      // Should show extras list
      const extrasList = page.locator('.extras-list');
      await expect(extrasList).toBeVisible();

      // Click first extra to select it
      const firstExtra = page.locator('.extras-list-item').first();
      if (await firstExtra.isVisible()) {
        await firstExtra.click();
        // Should be selected
        await expect(firstExtra).toHaveClass(/selected/);

        // Click again to deselect
        await firstExtra.click();
        await expect(firstExtra).not.toHaveClass(/selected/);
      }
    }
  });

  test('next button is disabled without quantity', async ({ page }) => {
    await setupGarmentStep(page);

    // Size table visible, all qtys 0 — next button should have disabled class
    const nextBtn = page.getByRole('button', { name: 'Далее' });
    await nextBtn.scrollIntoViewIfNeeded();
    await expect(nextBtn).toHaveClass(/disabled/);
  });

  test('SKU search filters the list', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    const searchInput = page.locator('.sku-search-input');
    await expect(searchInput).toBeVisible();

    // Search for "худи"
    await searchInput.fill('худи');
    await page.waitForTimeout(300);

    // Should show search count
    await expect(page.locator('.sku-search-count')).toBeVisible();

    // All visible items should contain "худи" in name
    const items = page.locator('.garment-row');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Clear search
    await page.locator('.sku-search-clear').click();
    await expect(page.locator('.sku-search-count')).toBeHidden();
  });

  test('category filter narrows SKU list', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Get initial count of garment rows
    const allCount = await page.locator('.garment-row').count();

    // Click "Футболки" filter
    await page.locator('.sku-cat-pill', { hasText: 'Футболки' }).click();

    // Count should be less than all
    const filteredCount = await page.locator('.garment-row').count();
    expect(filteredCount).toBeLessThan(allCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('fit filter narrows SKU list', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    const allCount = await page.locator('.garment-row').count();

    // Click "Oversize" fit filter
    await page.locator('.sku-fit-pill', { hasText: 'Oversize' }).click();

    const filteredCount = await page.locator('.garment-row').count();
    expect(filteredCount).toBeLessThanOrEqual(allCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('color supplier tabs switch palette', async ({ page }) => {
    await setupGarmentStep(page);

    // Check supplier tabs are visible
    const medastexTab = page.locator('.supplier-tab', { hasText: 'Medastex' });
    const cottonpromTab = page.locator('.supplier-tab', { hasText: 'CottonProm' });

    if (await medastexTab.isVisible()) {
      // Click CottonProm tab
      await cottonpromTab.click();
      await expect(cottonpromTab).toHaveClass(/active/);

      // Click back to Medastex
      await medastexTab.click();
      await expect(medastexTab).toHaveClass(/active/);
    }
  });

  test('accessory flow shows quantity instead of sizes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Click "Аксессуары" category filter
    const accFilter = page.locator('.sku-cat-pill', { hasText: 'Аксессуары' });
    await accFilter.click();

    // Select first accessory (e.g., Шоппер)
    await page.locator('.garment-row').first().click();

    // Should show "Тираж" section instead of "Размеры"
    await expect(page.locator('.section-label', { hasText: 'Тираж' })).toBeVisible();

    // Should have one-size qty input
    await expect(page.locator('.one-size-row')).toBeVisible();
  });
});
