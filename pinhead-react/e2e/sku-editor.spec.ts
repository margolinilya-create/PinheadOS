// spec: «Каталог моделей и цен» (/sku) — вкладки, адрес, правила, зоны, цены
// seed: pinhead-react/e2e/navigation.spec.ts
// Веха 8 (задача 3): экран на примитивах ERP — селекторы ролями, не классами.

import { test, expect, type Page } from '@playwright/test';

test.use({ actionTimeout: 15000 });

const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const sub = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Разделы прайса' }).getByRole('tab', { name: new RegExp(`^${name}`) });

test.describe('SKU Editor Navigation', () => {
  test('All 8 tabs render and switch correctly', async ({ page }) => {
    await page.goto('/sku');
    await expect(page.getByRole('heading', { level: 1, name: 'Каталог моделей и цен' })).toBeVisible({ timeout: 10000 });
    const list = page.getByRole('tablist', { name: 'Разделы каталога' });
    await expect(list.getByRole('tab')).toHaveText([
      'Изделия', 'Основная ткань', 'Отделочная ткань', 'Обработки',
      'Фурнитура', 'Ценообразование', 'Правила категорий', 'Зоны нанесения',
    ]);

    await tab(page, 'Основная ткань').click();
    await expect(page.getByRole('region', { name: 'Основные ткани' })).toBeVisible();

    await tab(page, 'Ценообразование').click();
    await expect(page.getByRole('tablist', { name: 'Разделы прайса' })).toBeVisible();

    await tab(page, 'Правила категорий').click();
    await expect(page.getByRole('button', { name: /^Футболки/ })).toBeVisible();
    await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveCount(11);

    await tab(page, 'Зоны нанесения').click();
    await expect(page.getByRole('table', { name: 'Справочник зон нанесения' })).toBeVisible();
  });

  test('URL param ?tab=pricing opens Pricing tab directly', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await expect(tab(page, 'Ценообразование')).toHaveAttribute('aria-selected', 'true', { timeout: 10000 });
    await expect(page.getByRole('tablist', { name: 'Разделы прайса' })).toBeVisible();
  });

  test('/prices redirects to /sku?tab=pricing', async ({ page }) => {
    await page.goto('/prices');
    await expect(page.getByRole('tablist', { name: 'Разделы прайса' })).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain('/sku');
    expect(page.url()).toContain('tab=pricing');
  });

  test('Active tab is reflected in URL param', async ({ page }) => {
    await page.goto('/sku');
    await expect(tab(page, 'Изделия')).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain('tab=');

    await tab(page, 'Ценообразование').click();
    await expect(page).toHaveURL(/tab=pricing/);

    await tab(page, 'Изделия').click();
    expect(page.url()).not.toContain('tab=');
  });

  test('правка модели — точка «есть несохранённые правки» в имени вкладки', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1280) <= 760, 'На телефоне каталог только для просмотра');
    await page.goto('/sku');
    const name = page.getByRole('textbox', { name: /^Название:/ }).first();
    await expect(name).toBeVisible({ timeout: 10000 });
    await name.fill('Футболка правка');
    await expect(page.getByRole('tab', { name: 'Изделия, есть несохранённые правки' })).toBeVisible();
  });
});

test.describe('SKU Editor — Правила категорий', () => {
  test('Category accordion expands with all sections', async ({ page }) => {
    await page.goto('/sku?tab=rules');
    const tee = page.getByRole('button', { name: /^Футболки/ });
    await expect(tee).toBeVisible({ timeout: 10000 });
    await tee.click();
    await expect(tee).toHaveAttribute('aria-expanded', 'true');

    await expect(page.getByRole('heading', { name: 'Техники нанесения' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Техники по зонам' })).toBeVisible();
    await expect(page.getByLabel('Минимальный тираж (MOQ)')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Доступные размеры' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Обработки по умолчанию' })).toBeVisible();
  });

  test('Only one category expanded at a time', async ({ page }) => {
    await page.goto('/sku?tab=rules');
    await expect(page.getByRole('button', { name: /^Футболки/ })).toBeVisible({ timeout: 10000 });
    const expanded = page.locator('button[aria-expanded="true"][aria-controls^="cat-rule-"]');

    await page.getByRole('button', { name: /^Футболки/ }).click();
    await expect(expanded).toHaveCount(1);

    await page.getByRole('button', { name: /^Худи/ }).click();
    await expect(expanded).toHaveCount(1);
  });
});

test.describe('SKU Editor — Зоны нанесения', () => {
  const zones = (page: Page) => page.getByRole('table', { name: 'Справочник зон нанесения' });

  test('Zones table renders with existing zones (только просмотр)', async ({ page }) => {
    await page.goto('/sku?tab=zones');
    await expect(zones(page)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Справочник зон нанесения — только просмотр')).toBeVisible();

    // Зоны по умолчанию: 8 прежних + левая и правая штанина (правка 13.10)
    // + штанина перед/зад (веха 5а)
    await expect(zones(page).locator('tbody tr')).toHaveCount(12, { timeout: 5000 });
  });

  test('правка зон — ссылкой на «Справочники заказа» → «Флэты и зоны» (веха 5б)', async ({ page }) => {
    await page.goto('/sku?tab=zones');
    await expect(zones(page)).toBeVisible({ timeout: 10000 });

    // Ни добавления, ни удаления: справочник зон правится в одном месте
    await expect(zones(page).locator('input, button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Флэты и зоны/ }))
      .toHaveAttribute('href', '/order-settings?tab=flats&part=zones');
  });
});

test.describe('SKU Editor — Ценообразование sub-tabs', () => {
  test('All 8 pricing sub-tabs switch correctly', async ({ page }) => {
    await page.goto('/sku?tab=pricing');
    await expect(page.getByRole('tablist', { name: 'Разделы прайса' })).toBeVisible({ timeout: 10000 });

    await sub(page, 'Вышивка').click();
    await expect(page.getByText('Стежков на 1 см²')).toBeVisible();

    await sub(page, 'DTF').click();
    await expect(page.getByText('DTF — ступени цены за погонный метр')).toBeVisible();

    await sub(page, 'DTG').click();
    await expect(page.getByText('DTG — цена за одно нанесение, ₽')).toBeVisible();

    await sub(page, 'Наценки').click();
    await expect(page.getByRole('table', { name: 'Наценка по группам и тиражу' })).toBeVisible();

    await sub(page, 'Доп').click();
    await expect(page.getByText('Бирка')).toBeVisible();

    await sub(page, 'История').click();
    await expect(page.getByText('История изменений')).toBeVisible();
  });
});

test.describe('SKU Editor — телефон (К2 вехи 8)', () => {
  test('на 375 px — только просмотр, без горизонтальной прокрутки страницы', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/sku');
    await expect(page.getByRole('note')).toHaveText('На телефоне каталог только для просмотра. Править — с компьютера.', { timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Выгрузить в Excel' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить из Excel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сохранить каталог' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /^Название:/ }).first()).toBeDisabled();
    for (const name of ['Изделия', 'Основная ткань', 'Ценообразование', 'Правила категорий']) {
      await tab(page, name).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `горизонтальная прокрутка на вкладке «${name}»`).toBeLessThanOrEqual(0);
    }
  });
});
