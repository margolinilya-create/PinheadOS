import { test, expect } from '@playwright/test';
import { installSupabaseMock, buildStages, FX_CREATED } from './support/mockSupabase';

/**
 * Экран «Склад» — главный экран пилота, и до 22.08 он не открывался НИ В ОДНОЙ
 * спеке. Ни unit-теста, ни e2e: `screens/Warehouse.jsx` и все пять карточек
 * задач (`MaterialReceiptCard`, `MarkingCard`, `PackShipCard`, `FgReceiptCard`,
 * `SubcontractReceiptCard`) были непокрыты целиком.
 *
 * Здесь проверяется то, чего unit-тесты по построению не видят: доходит ли
 * задача до экрана, что показывает счётчик вкладки и можно ли объявить приёмку,
 * не сказав, сколько пришло.
 *
 * Заказы свои: базовые четыре держат visual-эталоны и счётчики соседних спек.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

/** База заказа: поля, которые ждёт список и карточка */
const ORDER_BASE = {
  customer: 'ООО «Ромашка»',
  manager: 'Анна',
  launch_date: '2026-07-18',
  due_date: '2026-07-28',
  buffer_days: 1,
  priority: 0,
  status: 'active',
  shipped_status: 'not_shipped',
  delivered_at: null,
  shipped_at: null,
  shipped_by: null,
  notes: null,
  packaging: 'none',
  packaging_note: null,
  stickers: 'none',
  stickers_note: null,
  no_chestny_znak: false,
  created_by: null,
  created_at: FX_CREATED,
  updated_at: FX_CREATED,
  attachments: [],
};

/**
 * Приёмка материалов: журнал приходов ПУСТ (`qty_received: null`) — ровно то
 * состояние, в котором на боевой базе оказались все девятнадцать позиций.
 */
const ORDER_RECEIPT = {
  ...ORDER_BASE,
  id: 'wh-a',
  bitrix_id: '77001',
  title: 'Свитшоты склад-тест',
  items: [{
    id: 'wh-a-i1',
    order_id: 'wh-a',
    product_type: 'Свитшот',
    variant: null,
    qty: 50,
    production_type: 'sewing',
    branding_methods: [],
    branding_on: 'cut',
    notes: null,
    size_grid: null,
    sort_order: 10,
    created_at: FX_CREATED,
    updated_at: FX_CREATED,
    stages: buildStages('wh-a-i1', [
      { code: 'supply', status: 'done' },
      { code: 'cutting', status: 'waiting', deps: [0] },
    ]),
    prints: [],
  }],
  materials: [{
    id: 'wh-a-m1', order_id: 'wh-a', item_id: null, kind: 'fabric',
    name: 'Футер трёхнитка', source: 'purchase', qty: '100 кг',
    qty_expected: 100, qty_received: null, unit: 'кг',
    status: 'received', accept_status: null, eta_date: null, received_at: null,
    notes: null, created_at: FX_CREATED, updated_at: FX_CREATED,
  }],
  warehouse_tasks: [{
    id: 'wh-a-t1', order_id: 'wh-a', item_id: null, stage_id: null,
    task_type: 'material_receipt', status: 'awaiting',
    marking_type: null, deadline: null, note: null,
    created_at: FX_CREATED, updated_at: FX_CREATED,
  }],
};

/** Приёмка готовой продукции — тип, счётчик которого давал NaN */
const ORDER_FG = {
  ...ORDER_BASE,
  id: 'wh-b',
  bitrix_id: '77002',
  title: 'Худи приёмка ГП',
  items: [{
    ...ORDER_RECEIPT.items[0],
    id: 'wh-b-i1',
    order_id: 'wh-b',
    product_type: 'Худи',
    qty: 30,
    stages: buildStages('wh-b-i1', [{ code: 'sewing', status: 'done' }]),
  }],
  materials: [],
  warehouse_tasks: [{
    id: 'wh-b-t1', order_id: 'wh-b', item_id: null, stage_id: null,
    task_type: 'fg_receipt', status: 'awaiting',
    marking_type: null, deadline: null, note: null,
    created_at: FX_CREATED, updated_at: FX_CREATED,
  }],
};

const EXTRA = { orders: [ORDER_RECEIPT, ORDER_FG] };

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page, EXTRA);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Экран склада: задачи доходят до экрана', () => {
  test('задачи склада видны списком', async ({ page }) => {
    await page.goto('/warehouse?studio=0');

    const table = page.getByRole('table');
    await expect(table).toContainText('Свитшоты склад-тест');
    await expect(table).toContainText('Худи приёмка ГП');
  });

  /**
   * Счётчик вкладки «Приёмка ГП» давал `NaN`: инициализатор перечислял типы
   * задач руками и пропускал `fg_receipt`, поэтому `undefined + 1` = NaN,
   * проверка `> 0` всегда ложна, и число открытых задач не показывалось
   * НИКОГДА. Ошибка тихая — экран выглядит рабочим, просто одна цифра пуста.
   */
  test('«Приёмка ГП» показывает число открытых задач', async ({ page }) => {
    await page.goto('/warehouse?studio=0');

    /*
     * Точка входа теперь ОДНА (обход 04.09): плитки-показатели сняты — они
     * были тем же фильтром, нарисованным вторым видом, и успели разойтись
     * с чипами (тип «Передача подрядчику» был только у чипов). Проверяемое
     * свойство не изменилось: счётчик показывает число и не показывает NaN.
     */
    const chip = page.getByRole('button', { name: /Приёмка ГП/ });
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText('1');
    await expect(chip).not.toContainText('NaN');
  });

  /**
   * Второй вид того же фильтра не должен вернуться: плитки и чипы отбирают
   * одно и то же, а два вида у одной работы однажды разъезжаются — здесь
   * это уже случилось.
   */
  test('фильтр типов задач нарисован ровно одним видом', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await expect(page.getByRole('button', { name: /Приёмка материалов/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Упаковка\/отгрузка/ })).toHaveCount(1);
  });
});

test.describe('Приёмка материала: приход обязателен', () => {
  test('карточка открывается и показывает план', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await page.getByRole('row').filter({ hasText: 'Свитшоты склад-тест' })
      .getByRole('button', { name: 'Открыть' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('Футер трёхнитка');
    await expect(drawer).toContainText('100');
  });

  /**
   * Главная проверка контура. На боевой базе девять материалов были «приняты»
   * при полностью пустом журнале приходов: приёмка и приход были двумя формами,
   * и вторая работала без первой. Теперь действие одно, и объявить приёмку,
   * не сказав, сколько пришло, нельзя — гейт стоит на сервере, а кнопка гасится
   * по тому же правилу.
   */
  test('«Принять» погашена, пока не указано количество, и причина названа', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await page.getByRole('row').filter({ hasText: 'Свитшоты склад-тест' })
      .getByRole('button', { name: 'Открыть' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Принять' })).toBeDisabled();
    await expect(drawer).toContainText('Укажите, сколько пришло');
  });

  test('количество введено — кнопка открывается', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await page.getByRole('row').filter({ hasText: 'Свитшоты склад-тест' })
      .getByRole('button', { name: 'Открыть' }).click();

    const drawer = page.getByRole('dialog');
    await drawer.getByLabel(/Сколько пришло сейчас/).fill('60');
    await expect(drawer.getByRole('button', { name: 'Принять' })).toBeEnabled();
  });

  /**
   * Форм было ДВЕ — «Записать приход» и «Принять», каждая со своим селектом
   * статуса. Второй селект рядом с величиной, которую ведёт журнал, — это
   * то самое «разрешение соврать», из-за которого журнал и остался пустым.
   */
  test('форма приёмки одна, отдельной «Записать приход» больше нет', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await page.getByRole('row').filter({ hasText: 'Свитшоты склад-тест' })
      .getByRole('button', { name: 'Открыть' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Записать приход' })).toHaveCount(0);
    await expect(drawer.getByLabel(/Статус приёмки/)).toHaveCount(1);
  });

  /** Сумма журнала — то, чего экран не показывал никогда */
  test('«Принято всего» показано и равно нулю при пустом журнале', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await page.getByRole('row').filter({ hasText: 'Свитшоты склад-тест' })
      .getByRole('button', { name: 'Открыть' }).click();

    await expect(page.getByRole('dialog')).toContainText('Принято всего');
  });
});
