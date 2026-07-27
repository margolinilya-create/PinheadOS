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
    // Сначала ждём сам пункт меню: заголовок группы появляется вместе с сайдбаром,
    // и проверка его видимости первой ловила гонку монтирования под нагрузкой
    for (const name of ['Закрой', 'Шелкография', 'ДТФ', 'Вышивка', 'Швейка', 'ВТО']) {
      await expect(sidebar.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(sidebar.getByText('Цеха', { exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: /Канбан/ }).click();
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

test.describe('Варианты поставщиков в закупке (правка 10)', () => {
  test('ячейка поставщика открывает сравнение вариантов', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    const cell = page.getByRole('button', { name: /не выбран|вариант/ }).first();
    await expect(cell).toBeVisible();
    await cell.click();

    const dialog = page.getByRole('dialog', { name: /Поставщики:/ });
    await expect(dialog).toBeVisible();
    // Базовый набор полей сравнения, утверждённый заказчиком
    for (const label of ['Поставщик', 'Цена', 'Наличие', 'Срок поставки, дней', 'Минимальная партия', 'Примечание']) {
      await expect(dialog.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: '+ Добавить вариант' })).toBeDisabled();
    await dialog.getByLabel('Поставщик', { exact: true }).fill('Астра Текстиль');
    await expect(dialog.getByRole('button', { name: '+ Добавить вариант' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Технические задания в PDF (волна 4)', () => {
  test('форма создания не даёт сабмит без ТЗ и называет позицию и цеха', async ({ page }) => {
    await page.goto('/orders?studio=0');
    await page.getByRole('button', { name: '+ Новый заказ' }).click();

    const form = page.locator('form');
    await expect(form.getByRole('button', { name: 'ТЗ в PDF для цехов' })).toBeVisible();

    // Пока позиция не заполнена — маршрута нет, требовать нечего
    await expect(form.getByText('Заполните позицию')).toBeVisible();

    await form.getByLabel('Название *').fill('Проверка ТЗ');
    await form.getByLabel('Изделие *').first().fill('Футболка Regular');
    await form.getByLabel('Кол-во *').first().fill('50');

    // Маршрут сшивного изделия: закрой → швейка → ВТО, ТЗ не назначено ни одному
    await expect(form.getByText('Позиция: Футболка Regular')).toBeVisible();
    const msg = form.getByText(/Невозможно создать заказ/);
    await expect(msg).toBeVisible();
    await expect(msg).toContainText('«Футболка Regular»');
    await expect(msg).toContainText('Закрой');
    await expect(msg).toContainText('Швейка');
    await expect(form.getByRole('button', { name: 'Создать заказ' })).toBeDisabled();

    // Закупка ТЗ не требует — её в списке назначений нет
    await expect(form.getByRole('combobox', { name: /ТЗ для цеха Закупка/ })).toHaveCount(0);
  });

  test('задание цеха показывает назначенное ТЗ с кнопкой «Открыть ТЗ»', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    // Заказ B: закрой в работе, общий PDF назначен цеху
    const row = page.locator('[class*="queueRow"]').filter({ hasText: '54900' }).first();
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Открыть' }).click();

    await expect(page).toHaveURL(/\/task\//);
    await expect(page.getByText('Форма официантов.pdf').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Открыть ТЗ' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Скачать' }).first()).toBeVisible();
  });

  test('карточка заказа даёт назначить ТЗ по цехам', async ({ page }) => {
    await page.goto('/orders/ord-b?studio=0');
    await expect(page.getByText('Технические задания (PDF)')).toBeVisible();
    await expect(page.getByText('Кто по какому ТЗ работает').first()).toBeVisible();
    // Назначение видно как выбранный документ у производственного цеха
    const select = page.getByRole('combobox', { name: /ТЗ для цеха Закройный цех/ }).first();
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('tz-grp-b');
  });
});

/**
 * Волна UX-2: обрыв связи не должен выглядеть как «работы нет».
 * Раньше при упавшем запросе очередь показывала «Выберите свой цех выше»,
 * а список заказов — пустой тулбар без единой строки; повторить было нечем,
 * потому что эффект `if (!loaded) loadAll()` второй раз не срабатывает.
 */
test.describe('Ошибка загрузки (волна UX-2)', () => {
  /** Роняет запрос заказов; вернуть связь — снять флаг из возвращённой функции */
  async function breakOrders(page: import('@playwright/test').Page) {
    let broken = true;
    await page.route('**/rest/v1/erp_orders*', async (route) => {
      if (!broken) return route.fallback();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'network down' }),
      });
    });
    return () => { broken = false; };
  }

  test('очередь цеха предлагает повторить и восстанавливается', async ({ page }) => {
    const restore = await breakOrders(page);
    await page.goto('/queue?studio=0');
    // Оболочка появляется раньше данных; ждём её, чтобы не мерить холодный старт
    // Vite вместе с ответом сервера — под параллельными воркерами это разные величины
    await expect(page.getByRole('complementary')).toBeVisible();

    const failed = page.getByText('Не удалось загрузить задания цеха');
    await expect(failed).toBeVisible();
    // Самое важное: это НЕ читается как «заданий нет»
    await expect(page.getByText('Выберите свой цех выше')).toHaveCount(0);

    restore();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(failed).toHaveCount(0);
    // Вкладки цехов рисуются только по загруженным departments — значит данные пришли
    await expect(page.getByRole('tablist', { name: 'Выбор цеха' })).toBeVisible();
  });

  test('список заказов предлагает повторить вместо пустого экрана', async ({ page }) => {
    const restore = await breakOrders(page);
    await page.goto('/orders?studio=0');
    await expect(page.getByRole('complementary')).toBeVisible();

    const failed = page.getByText('Не удалось загрузить заказы');
    await expect(failed).toBeVisible();

    restore();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(failed).toHaveCount(0);
    await expect(page.getByText('54900').first()).toBeVisible();
  });
});
