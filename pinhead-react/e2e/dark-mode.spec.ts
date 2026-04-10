import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

test.describe('Dark mode', () => {
  test('theme toggle switches to dark mode', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();

    // Find and click theme toggle
    const toggle = page.locator('.theme-toggle');
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
    await page.locator('.theme-toggle').click();

    // Navigate to orders
    await page.goto('/orders');
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('dark');
  });
});
