// E2E smoke tests: navigation between core routes
// Plan: tests/E2E-TEST-PLAN.md — Kanban, Analytics, Editors groups

import { test, expect } from '@playwright/test';

test.use({ actionTimeout: 10000 });

test.describe('Core navigation', () => {
  test('wizard page loads with step 1 visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible();
    await expect(page.locator('.garment-row').first()).toBeVisible();
  });

  test('kanban route loads with board header', async ({ page }) => {
    await page.goto('/orders');
    // Board container renders even if orders list is empty
    await expect(page.locator('.kanban-board, .kanban-stats-bar').first()).toBeVisible({ timeout: 10000 });
  });

  test('express calculator route loads', async ({ page }) => {
    await page.goto('/express');
    // Any element with text EXPRESS or КАЛЬКУЛЯТОР appears in header
    await expect(page.getByText(/EXPRESS|КАЛЬКУЛЯТОР/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('header logo link returns to wizard', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.locator('.kanban-board, .kanban-stats-bar').first()).toBeVisible({ timeout: 10000 });
    // Click the header logo / brand
    const logo = page.locator('.logo, .logo-text').first();
    if (await logo.isVisible()) {
      await logo.click();
      await expect(page.getByRole('heading', { name: 'ИЗДЕЛИЕ' })).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('Keyboard shortcuts dialog (Kanban)', () => {
  test('opens via "?" key and has dialog role', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.locator('.kanban-board, .kanban-stats-bar').first()).toBeVisible({ timeout: 10000 });

    // Ensure focus is not in an input so the shortcut triggers
    await page.locator('body').click();
    await page.keyboard.press('Shift+Slash'); // "?"

    const dialog = page.getByRole('dialog', { name: /Горячие клавиши/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Поиск')).toBeVisible();

    // Close with button
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toBeHidden();
  });
});
