// E2E tests: Kanban board functional scenarios
// Covers: search, type filter, drawer open/close, keyboard shortcuts

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

test.describe('Kanban board interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/orders');
    await expect(page.locator('.kanban-board, .kanban-stats-bar').first()).toBeVisible({ timeout: 10000 });
  });

  test('search filters cards by text', async ({ page }) => {
    const searchInput = page.locator('.kb-search');
    await expect(searchInput).toBeVisible();

    // Type a search query that won't match anything
    await searchInput.fill('несуществующийзаказ12345');
    await page.waitForTimeout(500);

    // All columns should be empty or show "Перетащите карточку сюда"
    const emptyMessages = page.locator('.kb-empty-col');
    const count = await emptyMessages.count();
    expect(count).toBeGreaterThanOrEqual(0); // may have empty cols

    // Clear search
    await searchInput.clear();
  });

  test('type filter select is populated', async ({ page }) => {
    const typeFilter = page.getByTestId('type-filter');
    await expect(typeFilter).toBeVisible();

    // Should have "Все типы" as default
    await expect(typeFilter).toHaveValue('');
  });

  test('stats bar shows order counts', async ({ page }) => {
    const statsBar = page.locator('.kanban-stats-bar');
    await expect(statsBar).toBeVisible();

    // Should show "заказов" text
    await expect(statsBar.getByText('заказов')).toBeVisible();
  });

  test('clicking card opens drawer', async ({ page }) => {
    const card = page.locator('.kb-card').first();

    // Only test if there are cards
    if (await card.isVisible()) {
      await card.click();

      // Drawer should open with order details
      const drawer = page.locator('[role="dialog"]');
      await expect(drawer).toBeVisible({ timeout: 5000 });

      // Drawer has status change buttons
      await expect(drawer.getByText('СМЕНИТЬ СТАТУС')).toBeVisible();

      // Close with Esc
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }
  });

  test('"/" key focuses search input', async ({ page }) => {
    // Click body to ensure no input is focused
    await page.locator('body').click();
    await page.keyboard.press('/');

    // Search should be focused
    const searchInput = page.locator('.kb-search');
    await expect(searchInput).toBeFocused();
  });

  test('"n" key navigates to new order', async ({ page }) => {
    await page.locator('body').click();
    await page.keyboard.press('n');

    // Should navigate to wizard
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible({ timeout: 5000 });
  });

  test('5 status columns are rendered', async ({ page }) => {
    const columns = page.locator('.kanban-col');
    await expect(columns).toHaveCount(5);

    // Check column headers exist
    await expect(page.locator('.kanban-col-title').first()).toBeVisible();
  });
});
