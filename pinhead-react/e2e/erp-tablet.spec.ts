import { test, expect } from '@playwright/test';
import { installSupabaseMock, buildStages } from './support/mockSupabase';

/**
 * Планшет цеха (проект `tablet`, 768×1024, hasTouch).
 *
 * Это основное рабочее устройство ERP, и до 29.07.2026 оно не было покрыто
 * ничем: гонялись только 1280 и 375. Ровно в этой дыре жил баг — брейкпоинт
 * стоял на `max-width: 760px`, а планшет в портрете это 768–800 CSS-px, то есть
 * **760 < 768**. Следствия: тач-оптимизированная `QueueCard` не показывалась
 * ни на одном реальном цеховом устройстве, а сайдбар оставался постоянной
 * колонкой 236px и оставлял под сетку строки очереди ~456px при нужных ~710px —
 * рабочая область уезжала вбок вместе с колонкой действий.
 *
 * Спек проверяет не «пиксель в пикселе», а три свойства, которые и ломались:
 * тот ли компонент отрисован, влезает ли он в экран, доступны ли действия.
 */

const FIXED_TIME = new Date('2026-07-20T09:00:00');

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.clock.setFixedTime(FIXED_TIME);
});

test.describe('Очередь цеха на планшете', () => {
  test('задания рисуются карточками, а не десктопной строкой', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    // Именно это и было сломано: на 768px рендерился QueueRow
    await expect(page.locator('[class*="queueRowMain"]')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('карточка целиком влезает в ширину экрана', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const card = page.locator('[class*="queueCard"]').first();
    await expect(card).toBeVisible();
    const viewport = page.viewportSize();
    // toPass: список догружается и перемонтирует карточки — одиночный
    // boundingBox() ловит уже отсоединённый узел
    await expect(async () => {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    }).toPass({ timeout: 10_000 });
  });

  test('действия цеха видны без горизонтальной прокрутки', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const viewport = page.viewportSize()!;
    // Раньше колонка действий уезжала за правый край: под сетку оставалось
    // ~456px при нужных ~710px. Проверяем каждую видимую кнопку действия.
    const actions = page.getByRole('button', { name: /Взять в работу|Записать результат|Завершить этап|Проблема/ });
    // Ждём появления кнопок, а не считаем сразу: карточка видна раньше, чем
    // панель действий получает права и данные этапа
    await expect(actions.first()).toBeVisible();
    const count = await actions.count();
    for (let i = 0; i < count; i += 1) {
      const box = await actions.nth(i).boundingBox();
      if (!box) continue;
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});

/**
 * Экраны пилота — «Склад» и «Закупка».
 *
 * До 22.08 планшетной раскладки у них не было вовсе: рисовалась та же таблица,
 * что на десктопе, — шесть колонок у склада и ЧЕТЫРНАДЦАТЬ у закупки. На 768px
 * это прокрутка на несколько экранов, а колонка «Действие» стоит последней,
 * то есть кнопка, ради которой на экран и приходят, оказывалась за краем.
 *
 * Тем временем `playwright.config.ts` исключал `erp-warehouse.spec.ts` из
 * проекта `mobile` со словами «ниже 1024px экран показывает карточки» — их
 * не было ни одной. Комментарий описывал раскладку, которой не существует,
 * и покрытия при этом не было ни на одной ширине.
 */

const WH_ORDER = {
  id: 'tab-wh', bitrix_id: '90210', title: 'Свитшоты планшет-тест',
  customer: 'ООО «Ромашка»', manager: 'Анна',
  launch_date: '2026-07-18', due_date: '2026-07-28', buffer_days: 1,
  priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  attachments: [],
  items: [],
  materials: [{
    id: 'tab-wh-m1', order_id: 'tab-wh', item_id: null, kind: 'fabric',
    name: 'Футер трёхнитка', source: 'purchase', qty: '100 кг',
    qty_expected: 100, qty_received: null, unit: 'кг',
    status: 'received', accept_status: null, eta_date: null, received_at: null,
    notes: null, created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  }],
  warehouse_tasks: [{
    id: 'tab-wh-t1', order_id: 'tab-wh', item_id: null, stage_id: null,
    task_type: 'material_receipt', status: 'awaiting',
    marking_type: null, deadline: '2026-07-28', note: null,
    created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  }],
};

/**
 * Заказ с ПОДРЯДНЫМ этапом и карточкой подрядчика при нём.
 *
 * Свой заказ, а не правка базовых четырёх: те держат визуальные эталоны
 * и счётчики очередей, и добавленный подрядный этап сдвинул бы чужие проверки.
 */
const SUB_ORDER = {
  id: 'tab-sub', bitrix_id: '90311', title: 'Худи планшет-подряд',
  customer: 'ООО «Ромашка»', manager: 'Анна',
  launch_date: '2026-07-16', due_date: '2026-07-30', buffer_days: 1,
  priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  attachments: [],
  materials: [],
  warehouse_tasks: [],
  items: [{
    id: 'tab-sub-i1', order_id: 'tab-sub', product_type: 'Худи', variant: 'оверсайз',
    qty: 150, production_type: 'sewing', branding_methods: ['dtf'], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 0,
    subcontract_kind: null, material_source: 'pinhead',
    fit: null, main_fabric: null, trim_material: null,
    cutting_note: null, sewing_note: null, labels_note: null,
    packaging: 'inherit', packaging_size: null, sticker_place: null,
    marking_place: null, packaging_note: null,
    created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
    prints: [], labels: [],
    stages: buildStages('tab-sub-i1', [
      { code: 'cutting', status: 'done', qty_done: 150 },
      {
        code: 'dtf', status: 'in_progress', deps: [0],
        executor: 'contractor', contractor: 'ИП Петров', operation: 'Варка',
      },
      { code: 'sewing', status: 'waiting', deps: [1] },
    ]),
  }],
};

/** Карточка подрядчика ПРИ этапе — связь через `stage_id` */
const SUB_CARD = {
  id: 'tab-sub-op1', order_id: 'tab-sub', item_id: 'tab-sub-i1',
  stage_id: 'tab-sub-i1-st2', department_id: null, return_dept: null,
  op_type: 'operation', operation: 'Варка', contractor: 'ИП Петров',
  phase: 'at_contractor', status: 'at_contractor', payment_status: 'unpaid',
  material_source: 'pinhead', cycle: 0,
  qty_in_work: 150, qty_sent: 150, qty_returned: 0, qty_accepted: 0, qty_defect: 0,
  sent_date: '2026-07-19', planned_date: '2026-07-24', returned_date: null,
  cost: null, responsible: null, comment: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
};

/** Ширина документа не превышает экран — то, что и ломала широкая таблица */
async function expectNoHorizontalScroll(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Склад на планшете', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, { orders: [WH_ORDER] });
    await page.clock.setFixedTime(FIXED_TIME);
  });

  test('задачи рисуются карточками, а не таблицей из шести колонок', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    const card = page.getByRole('article', { name: /Приёмка материалов/ });
    await expect(card).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    await expect(page.getByRole('article').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('кнопка «Открыть» видна целиком и не мельче 44px', async ({ page }) => {
    await page.goto('/warehouse?studio=0');
    const open = page.getByRole('button', { name: 'Открыть' }).first();
    await expect(open).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = await open.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Закупка на планшете', () => {
  test('строки рисуются карточками, обе группы полей названы', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    const card = page.getByRole('article', { name: /^Закупка:/ }).first();
    await expect(card).toBeVisible();
    // Разделение ролей — требование документа, и смену раскладки оно переживает
    await expect(card).toContainText('Потребность — задал менеджер');
    await expect(card).toContainText('Факт — ведёт закупка');
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    await expect(page.getByRole('article', { name: /^Закупка:/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('Оболочка на планшете', () => {
  test('сайдбар — оверлей: не съедает ширину, открывается бургером', async ({ page }) => {
    await page.goto('/?studio=0');
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    // До 1024px сайдбар обязан быть оверлеем, иначе постоянная колонка 236px
    // забирает треть экрана планшета
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    const sewing = page.getByRole('complementary').getByRole('link', { name: /Швейка/ });
    await expect(sewing).not.toBeInViewport();

    await menu.click();
    await expect(sewing).toBeInViewport();
  });

  test('тач-таргеты действий не мельче 44px', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    const actions = page.getByRole('button', { name: /Взять в работу|Завершить этап|Проблема/ });
    await expect(actions.first()).toBeVisible();
    const count = await actions.count();
    for (let i = 0; i < count; i += 1) {
      const box = await actions.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
});

/**
 * «Подряд» на планшете (доделка next steps сессии 36).
 *
 * Таблица здесь из ДЕСЯТИ колонок, и кнопка «Этап» — та, которой раскрывают
 * действия по подрядной операции, — стоит последней. Ниже 1024px она уезжала
 * за край экрана, то есть до действий было не добраться вовсе. Тот же дефект,
 * который до этого чинили у склада и закупки.
 */
test.describe('Подряд на планшете', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, { orders: [SUB_ORDER], subcontracting: [SUB_CARD] });
    await page.clock.setFixedTime(FIXED_TIME);
  });

  test('подрядные этапы рисуются карточками, а не таблицей из десяти колонок', async ({ page }) => {
    await page.goto('/subcontracting?studio=0');
    const card = page.getByRole('article', { name: /^Подряд:/ }).first();
    await expect(card).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/subcontracting?studio=0');
    await expect(page.getByRole('article', { name: /^Подряд:/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('главное действие видно целиком и не мельче 44px', async ({ page }) => {
    await page.goto('/subcontracting?studio=0');
    // Ради этой кнопки на экран и приходят: она раскрывает действия этапа
    const open = page.getByRole('button', { name: /^Этап · принято/ }).first();
    await expect(open).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = await open.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('подписи полей стоят явно — без шапки таблицы «150» ничего не значит', async ({ page }) => {
    await page.goto('/subcontracting?studio=0');
    const card = page.getByRole('article', { name: /^Подряд:/ }).first();
    await expect(card).toBeVisible();
    for (const label of ['В работе', 'Операция', 'Подрядчик', 'Где заказ сейчас']) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
  });
});
