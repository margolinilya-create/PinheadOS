import { test, expect } from '@playwright/test';
import { installSupabaseMock } from './support/mockSupabase';

/**
 * Волна 1 «Ядро диспетчера»: постоянное меню цехов, компактная очередь из трёх
 * блоков, приоритеты, страница производственного задания, переходы в заказ,
 * кликабельные показатели закупки.
 *
 * Гоняется против dev-сервера с dev-автологином и замоканным Supabase
 * (support/mockSupabase.ts) — реальной БД не требуется. Время заморожено,
 * чтобы сроки в фикстурах не дрейфовали.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Навигация ERP (правки 1 и 13)', () => {
  test('в сайдбаре есть группа «Цеха» со всеми участками', async ({ page }) => {
    await page.goto('/?studio=0');
    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByText('Цеха', { exact: true })).toBeVisible();
    for (const name of ['Закрой', 'Шелкография', 'ДТФ', 'Вышивка', 'Швейка', 'ВТО']) {
      await expect(sidebar.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
  });

  test('пункт цеха открывает его рабочую очередь', async ({ page }) => {
    await page.goto('/?studio=0');
    await page.getByRole('link', { name: /Швейка/ }).click();
    await expect(page).toHaveURL(/\/queue\/sewing/);
    await expect(page.getByRole('heading', { name: 'Швейный цех' })).toBeVisible();
  });

  test('логотип возвращает на главную из любого раздела', async ({ page }) => {
    await page.goto('/orders?studio=0');
    const brand = page.getByRole('link', { name: 'На главную ERP' });
    await expect(brand).toBeVisible();
    // Кликабелен весь блок, а не только буква: в ссылку входит и иконка, и надпись
    await expect(brand.getByText('PINHEAD ERP')).toBeVisible();
    await brand.click();
    await expect(page.getByRole('heading', { name: 'Обзор производства' })).toBeVisible();
  });
});

test.describe('Рабочая очередь цеха (правки 2, 3, 9)', () => {
  test('очередь показывает блоки в порядке требования', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueRow"]').first()).toBeVisible();
    const headings = page.getByRole('heading', { level: 2 });
    await expect(headings.first()).toBeVisible();
    const titles = (await headings.allTextContents())
      .map((t) => t.replace(/\s+/g, ' ').trim());
    // Сначала что делается, потом что запускать, потом что ждёт (правка 2)
    const seq = ['В работе', 'Готово к запуску', 'Ожидает']
      .map((t) => titles.findIndex((x) => x.includes(t)))
      .filter((i) => i >= 0);
    expect(seq.length).toBeGreaterThan(0);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
    // «Завершено недавно» — четвёртым и свёрнуто
    expect(titles.some((t) => t.includes('Завершено недавно'))).toBe(true);
  });

  test('строка очереди показывает заказ, срок, статус и готовность', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const row = page.locator('[class*="queueRow"]').first();
    await expect(row).toBeVisible();
    // Номер заказа кликабелен прямо из очереди (правка 6)
    const orderLink = row.getByRole('link', { name: /№\d+/ });
    await expect(orderLink).toBeVisible();
    await expect(orderLink).toHaveAttribute('title', /Открыть заказ №/);
    await expect(row.getByRole('link', { name: 'Открыть' })).toBeVisible();
    // Количество, срок, исполнитель и процент готовности — в одной строке
    await expect(row.getByText(/\d+ шт/)).toBeVisible();
    await expect(row.getByTitle('Исполнитель')).toBeVisible();
    await expect(row.getByTitle(/Сделано \d+ из \d+ шт/)).toBeVisible();
  });

  test('фильтры сбрасываются и сохраняются в адресе', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await page.getByRole('button', { name: /Просрочено/ }).click();
    await expect(page).toHaveURL(/overdue=1/);
    await page.getByRole('button', { name: 'Сбросить' }).click();
    await expect(page).not.toHaveURL(/overdue=1/);
  });
});

test.describe('Страница производственного задания (правки 5 и 6)', () => {
  test('открывается из очереди и показывает заказ, клиента и маршрут', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await page.locator('[class*="queueRow"]').first().getByRole('link', { name: 'Открыть' }).click();
    await expect(page).toHaveURL(/\/task\//);
    await expect(page.getByRole('link', { name: /Открыть заказ №/ })).toBeVisible();
    await expect(page.getByText('Клиент', { exact: true })).toBeVisible();
    await expect(page.getByText('Маршрут и прогресс')).toBeVisible();
    await expect(page.getByRole('link', { name: '← В очередь цеха' })).toBeVisible();
  });
});

test.describe('Производственный канбан (правка 4)', () => {
  test('колонки — производственные процессы', async ({ page }) => {
    await page.goto('/board?studio=0');
    await page.getByRole('tab', { name: /Канбан/ }).click();
    const board = page.getByRole('list', { name: 'Канбан по цехам' });
    await expect(board).toBeVisible();
    const heads = board.locator('section > :first-child');
    await expect(heads.first()).toBeVisible();
    const names = (await heads.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
    for (const dept of ['Закрой', 'Шелкография', 'ДТФ', 'Вышивка', 'Швейка', 'ВТО']) {
      expect(names.some((n) => n.startsWith(dept))).toBe(true);
    }
    // Дорожки внутри процесса — «Готово к работе» / «В работе» / «Завершено»
    await expect(board.getByText('Готово к работе').first()).toBeVisible();
  });
});

test.describe('Показатели закупки (правки 10 и 14)', () => {
  test('плитка показателя фильтрует список и сбрасывается', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await expect(page.getByRole('button', { name: /Всего строк/ })).toBeVisible();
    await page.getByRole('button', { name: /Ожидается/ }).first().click();
    await expect(page.getByText(/Фильтр: Ожидается/)).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить фильтр' }).click();
    await expect(page.getByText(/Фильтр: Ожидается/)).toHaveCount(0);
  });
});

test.describe('Админка: права и справочники (правки 11 и 12)', () => {
  test('вкладки админки включают «Права» и «Справочники»', async ({ page }) => {
    await page.goto('/admin?studio=0');
    const tabs = page.getByRole('tablist', { name: 'Разделы админки' });
    for (const name of ['Пользователи', 'Права', 'Цеха', 'Справочники', 'Заказы ТЗ']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
  });

  test('матрица прав — чекбокс на каждое право и роль', async ({ page }) => {
    await page.goto('/admin?tab=roles&studio=0');
    await expect(page.getByText('Матрица отвечает на вопрос')).toBeVisible();
    // Рядовой сотрудник цеха завершает этап, но не меняет приоритеты (дефолт сида)
    await expect(page.getByRole('checkbox', { name: 'Завершать этап — Сотрудник цеха' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Менять приоритеты — Сотрудник цеха' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Менять приоритеты — Бригадир' })).toBeChecked();
  });

  test('справочники: под-вкладки и статусы только для чтения', async ({ page }) => {
    await page.goto('/admin?tab=dicts&studio=0');
    const tabs = page.getByRole('tablist', { name: 'Справочники' });
    for (const name of ['Причины блокировок', 'Типы проблем', 'Типы изделий', 'Поставщики', 'Статусы']) {
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    }
    await tabs.getByRole('tab', { name: 'Статусы' }).click();
    await expect(page.getByText(/Переименовать их из админки нельзя/)).toBeVisible();
  });

  test('цеха: редактор с руководителем и нормативом', async ({ page }) => {
    await page.goto('/admin?tab=depts&studio=0');
    await expect(page.getByRole('button', { name: '+ Добавить участок' })).toBeVisible();
    const head = page.getByRole('columnheader');
    const names = await head.allTextContents();
    for (const col of ['Участок', 'Порядок', 'Руководитель', 'Норматив, дн']) {
      expect(names.some((n) => n.includes(col))).toBe(true);
    }
  });
});
