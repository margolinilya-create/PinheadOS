import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Visual-регрешн ключевых экранов.
 *
 * Гоняется против dev-сервера (dev-автологин админом «Dev Mode»), Supabase
 * замокан фикстурами (см. support/mockSupabase.ts) — реальной БД и секретов
 * не требуется. Время заморожено, чтобы «X дн.» и даты не дрейфовали.
 *
 * Флаг раздела переключается per-navigation через URL: `?studio=0` → ERP
 * (Производство), `?studio=1` → Order Studio (визард/каталог). URL-параметр
 * приоритетнее env, поэтому спек не зависит от VITE_FEATURE_ORDER_STUDIO.
 */

// Понедельник 2026-07-20 09:00 — относительно него считаются сроки в фикстурах.
const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

async function shoot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    threshold: 0.15,
  });
}

// ─── ERP (Производство) — флаг выключен (?studio=0) ───

test('visual: erp-dashboard', async ({ page }) => {
  await page.goto('/?studio=0');
  await expect(page.getByRole('heading', { name: 'Обзор производства' })).toBeVisible();
  await expect(page.getByText('Заказов в работе')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Загрузка цехов' })).toBeVisible();
  await expect(page.getByText('Горящие заказы')).toBeVisible();
  await shoot(page, 'erp-dashboard');
});

test('visual: erp-orders', async ({ page }) => {
  await page.goto('/orders?studio=0');
  await expect(page.getByRole('heading', { name: 'Заказы' })).toBeVisible();
  await expect(page.getByText('BOX39 худи чёрные')).toBeVisible();
  await expect(page.getByText('Шопперы эко «Маркет»')).toBeVisible();
  await shoot(page, 'erp-orders');
});

test('visual: erp-board', async ({ page }) => {
  await page.goto('/board?studio=0');
  await expect(page.getByRole('heading', { name: 'Производственный план' })).toBeVisible();
  await expect(page.getByText('BOX39 худи чёрные').first()).toBeVisible();
  await shoot(page, 'erp-board');
});

test('visual: erp-queue', async ({ page }) => {
  // Экран цеха: в dev нет привязки, поэтому выбираем цех заранее (localStorage).
  await page.addInitScript(() => {
    try { localStorage.setItem('erp_my_dept', 'cutting'); } catch { /* noop */ }
  });
  await page.goto('/queue?studio=0');
  await expect(page.getByRole('heading', { name: 'Закройный цех' })).toBeVisible();
  await expect(page.getByText('В работе')).toBeVisible();
  await expect(page.getByText('Готово к работе')).toBeVisible();
  await shoot(page, 'erp-queue');
});

// ─── Order Studio (каталог) — флаг включён (?studio=1) ───
// Каталоги замоканы пустыми → компоненты рендерятся на дефолтных данных.
// Визард (/) сюда не включён: его fullPage-скриншот нестабилен из-за
// ленивой подгрузки картинок SKU на длинной странице.

test('visual: studio-sku', async ({ page }) => {
  await page.goto('/sku?studio=1');
  await expect(page.getByText('Каталог SKU')).toBeVisible();
  await shoot(page, 'studio-sku');
});
