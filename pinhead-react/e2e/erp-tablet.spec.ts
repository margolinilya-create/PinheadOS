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
  /**
   * С правки 23.08 (п. 1) экран — мастер-деталь: строки материалов живут
   * в карточке ВЫБРАННОГО заказа, поэтому её сначала надо открыть. Список
   * сверху остаётся навигацией на любой ширине.
   */
  const openFirst = async (page) => {
    await page.goto('/purchasing?studio=0');
    // В планшетной фикстуре открытых этапов закупки нет — заказы лежат
    // в свёрнутом блоке «Завершённые» (п. 1.6): история остаётся достижимой.
    // Ждём блок ЯВНО: `count()` до загрузки данных вернул бы ноль, клика
    // не было бы вовсе, и упал бы уже следующий шаг — на пустом экране
    const summary = page.locator('summary').filter({ hasText: 'Завершённые закупки' });
    await expect(summary).toBeVisible();
    await summary.click();
    await page.getByRole('button', { name: 'Открыть' }).first().click();
  };

  /**
   * ОЧЕРЕДЬ ЗАКУПКИ — тоже карточками (правка 03.09).
   *
   * Приём 22.08 доехал до таблицы материалов (`PurchaseRowCard`), но не до
   * списка заказов над ней: шесть колонок, «Открыть» последняя — кнопка,
   * ради которой на экран и приходят, уезжала за правый край. Проверяем
   * на той ширине, на которой этим и пользуются.
   */
  test('очередь заказов рисуется карточками, действие во всю ширину и ≥44px', async ({ page }) => {
    await page.goto('/purchasing?studio=0');
    const archive = page.locator('summary').filter({ hasText: 'Завершённые закупки' });
    await expect(archive).toBeVisible();
    await archive.click();

    // Имя области несёт `role="list"`: на голом div `aria-label` не читается
    const list = page.getByRole('list', { name: 'Завершённые закупки' });
    await expect(list).toBeVisible();
    const card = list.getByRole('listitem').first();
    await expect(card).toBeVisible();
    // Подписи полей стоят явно: без шапки таблицы «через 8 дн.» ни о чём
    await expect(card).toContainText('Срок');
    await expect(card).toContainText('Материалы');

    const open = card.getByRole('button', { name: /^Открыть/ });
    const box = await open.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('строки рисуются карточками, обе группы полей названы', async ({ page }) => {
    await openFirst(page);
    const card = page.getByRole('article', { name: /^Закупка:/ }).first();
    await expect(card).toBeVisible();
    // Разделение ролей — требование документа, и смену раскладки оно переживает
    await expect(card).toContainText('Потребность — задал менеджер');
    await expect(card).toContainText('Факт — ведёт закупка');
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await openFirst(page);
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

/**
 * «Загрузка цехов» на планшете.
 *
 * Здесь не список, а МАТРИЦА «цех × семь дней + две сводные колонки»: десять
 * колонок на 768px не помещаются. Карточка на цех с лентой недели внутри
 * укладывается даже в 375px.
 *
 * Экрану нужны ПЛАНОВЫЕ ДАТЫ этапов — он считается только по ним. Базовые
 * фикстуры их не несут (как и боевая база: там их нет ни у одного открытого
 * этапа — отдельный пункт работ), поэтому спека заводит свой заказ с датами.
 */
const LOAD_ORDER = {
  id: 'tab-load', bitrix_id: '90412', title: 'Футболки планшет-загрузка',
  customer: 'ООО «Ромашка»', manager: 'Анна',
  launch_date: '2026-07-16', due_date: '2026-07-30', buffer_days: 1,
  priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  attachments: [], materials: [], warehouse_tasks: [],
  items: [{
    id: 'tab-load-i1', order_id: 'tab-load', product_type: 'Футболка', variant: null,
    qty: 200, production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, size_grid: null, sort_order: 0,
    subcontract_kind: null, material_source: 'pinhead',
    fit: null, main_fabric: null, trim_material: null,
    cutting_note: null, sewing_note: null, labels_note: null,
    packaging: 'inherit', packaging_size: null, sticker_place: null,
    marking_place: null, packaging_note: null,
    created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
    prints: [], labels: [],
    stages: buildStages('tab-load-i1', [
      { code: 'cutting', status: 'in_progress' },
      { code: 'sewing', status: 'waiting', deps: [0] },
    ]).map((st, i) => ({
      ...st,
      // Плановые даты внутри показываемой недели: без них экран честно
      // сообщает «планов нет», и проверять раскладку было бы не на чем
      planned_start: i === 0 ? '2026-07-20' : '2026-07-22',
      planned_end: i === 0 ? '2026-07-21' : '2026-07-23',
    })),
  }],
};

test.describe('Загрузка цехов на планшете', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, { orders: [LOAD_ORDER] });
    await page.clock.setFixedTime(FIXED_TIME);
  });

  test('загрузка рисуется карточками цехов, а не сеткой из десяти колонок', async ({ page }) => {
    await page.goto('/load?studio=0');
    await expect(page.getByRole('article', { name: /^Загрузка цеха/ }).first()).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/load?studio=0');
    await expect(page.getByRole('article', { name: /^Загрузка цеха/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('сводные величины подписаны — «12 шт» без подписи ничего не значит', async ({ page }) => {
    await page.goto('/load?studio=0');
    const card = page.getByRole('article', { name: /^Загрузка цеха/ }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText('Просрочено', { exact: true })).toBeVisible();
    await expect(card.getByText('Без плана', { exact: true })).toBeVisible();
  });
});

/**
 * Разработка (ЭКС) на планшете.
 *
 * Список — шесть колонок, из которых «Текущий блокер» и «Состояние» несут
 * по две строки текста каждая: ниже 1024px это уезжало за край вместе
 * с ответом на вопрос, ради которого на экран и приходят — «почему стоит».
 */
const DEV_FX = {
  id: 'tab-dev-1', order_id: 'ord-1', tech_name: 'Худи оверсайз, образец',
  technologist: 'Пётр', constructor: null, due_date: '2026-07-28',
  outcome: null, sku_code: null, pattern_tech_name: null,
  created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
  order: { id: 'ord-1', bitrix_id: '90001', title: 'Худи для сети', due_date: '2026-07-28' },
  tasks: [
    {
      id: 'tab-dev-t1', experimental_id: 'tab-dev-1', task_type: 'patterns',
      title: null, status: 'in_progress', assignee: 'Пётр', due_date: '2026-07-22',
      done_on: null, blocked_reason: null, depends_on: [], cycle: 0,
      stage_id: null, result_note: null, sort_order: 0,
      created_at: '2026-07-15T09:00:00Z', updated_at: '2026-07-15T09:00:00Z',
    },
  ],
};

test.describe('Разработка на планшете', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, { experimental: [DEV_FX] });
    await page.clock.setFixedTime(FIXED_TIME);
  });

  test('разработки рисуются карточками, а не таблицей из шести колонок', async ({ page }) => {
    await page.goto('/experimental?studio=0&view=list');
    await expect(page.getByRole('article', { name: /^Разработка:/ }).first()).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/experimental?studio=0&view=list');
    await expect(page.getByRole('article', { name: /^Разработка:/ }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('открытие — отдельная кнопка ≥44px, а не касание по всей карточке', async ({ page }) => {
    // Палец задевает карточку при прокрутке, и «переход по касанию» уводил бы
    // с экрана без спроса — у строки таблицы этой беды нет, там курсор
    await page.goto('/experimental?studio=0&view=list');
    const open = page.getByRole('button', { name: 'Открыть разработку' }).first();
    await expect(open).toBeVisible();
    const box = await open.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('блокер подписан — без шапки таблицы текст ни о чём не говорит', async ({ page }) => {
    await page.goto('/experimental?studio=0&view=list');
    const card = page.getByRole('article', { name: /^Разработка:/ }).first();
    await expect(card).toBeVisible();
    for (const label of ['Кто ведёт', 'Готовность', 'Срок', 'Текущий блокер']) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
  });
});

/**
 * Сотрудники и участки на планшете (админка).
 *
 * Обе таблицы шире всего в разделе — семь и девять колонок, — и в обеих
 * колонка действия стоит ПОСЛЕДНЕЙ: ниже 1024px за край уезжало ровно то,
 * ради чего на экран приходят. Руководитель заводит людей и настраивает
 * участки с того же планшета, с которого смотрит производство.
 */
const PROFILE_FX = {
  id: 'tab-p1', name: 'Мария Кузнецова', email: 'maria@pinhead.ru',
  role: 'manager', approved: true, active: true,
  created_at: '2026-07-01T09:00:00Z',
};

const LOOSE_EMP_FX = {
  id: 'tab-e2', profile_id: null, full_name: 'Иван Швея',
  role: 'worker', department_id: null, active: true, notes: null,
  created_at: '2026-07-01T09:00:00Z', updated_at: '2026-07-01T09:00:00Z',
};

test.describe('Сотрудники на планшете', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page, { profiles: [PROFILE_FX], employees: [LOOSE_EMP_FX] });
    await page.clock.setFixedTime(FIXED_TIME);
  });

  test('сотрудники рисуются карточками, а не таблицей из семи колонок', async ({ page }) => {
    await page.goto('/admin?tab=users&studio=0');
    await expect(page.getByRole('article', { name: /^Сотрудник / }).first()).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('работник без логина тоже карточкой — у его таблицы пять колонок', async ({ page }) => {
    await page.goto('/admin?tab=users&studio=0');
    await expect(page.getByRole('article', { name: 'Работник Иван Швея' })).toBeVisible();
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/admin?tab=users&studio=0');
    await expect(page.getByRole('article', { name: /^Сотрудник / }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('два селекта ролей подписаны — на вид они неразличимы', async ({ page }) => {
    // «Роль» решает доступ к разделам, «Цеховая роль» — права на этапы:
    // разные поля с разными последствиями, и без подписей их не отличить
    await page.goto('/admin?tab=users&studio=0');
    const card = page.getByRole('article', { name: /^Сотрудник / }).first();
    await expect(card).toBeVisible();
    for (const label of ['Роль', 'Цех', 'Цеховая роль']) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('действие видно целиком и не мельче 44px', async ({ page }) => {
    await page.goto('/admin?tab=users&studio=0');
    // Кнопку ищем ВНУТРИ карточки, а не по всей странице: в таблице она тоже
    // ≥44px и формально влезает в ширину, поэтому глобальный локатор оставался
    // зелёным и на сломанной раскладке — то есть сторожил бы пустоту
    const card = page.getByRole('article', { name: /^Сотрудник / }).first();
    await expect(card).toBeVisible();
    const off = card.getByRole('button', { name: 'Отключить Мария Кузнецова' });
    await expect(off).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = await off.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Участки на планшете', () => {
  test('участки рисуются карточками, а не таблицей из девяти колонок', async ({ page }) => {
    await page.goto('/admin?tab=depts&studio=0');
    await expect(page.getByRole('article', { name: /^Участок / }).first()).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/admin?tab=depts&studio=0');
    await expect(page.getByRole('article', { name: /^Участок / }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('числа подписаны — «10» и «3» без подписи несравнимы', async ({ page }) => {
    // Порядок в потоке и норматив в днях стоят рядом и оба короткие
    await page.goto('/admin?tab=depts&studio=0');
    const card = page.getByRole('article', { name: /^Участок / }).first();
    await expect(card).toBeVisible();
    for (const label of ['Порядок', 'Норматив, дн', 'Руководитель', 'Признаки', 'Ждёт материалы']) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test('главное действие — кнопка во всю ширину, не мельче 44px', async ({ page }) => {
    await page.goto('/admin?tab=depts&studio=0');
    const off = page.getByRole('button', { name: /Отключить участок/ }).first();
    await expect(off).toBeVisible();
    const box = await off.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Гант на планшете', () => {
  /**
   * Шкала на 60 дней в ширину планшета — полоса в пиксель: читать нечего.
   * Поэтому здесь ДРУГАЯ раскладка, а не та же в меньшем масштабе: карточка
   * на заказ с текстовыми интервалами этапов. Десктопная шкала проверяется
   * в `erp-gantt.spec.ts`, который на этой ширине исключён.
   */
  test('вместо шкалы — карточки заказов с интервалами', async ({ page }) => {
    await page.goto('/gantt?studio=0&from=2026-07-06&days=30');
    await expect(page.getByRole('list', { name: 'Этапы во времени' })).toBeVisible();
    // Десктопной сетки на этой ширине нет вовсе
    await expect(page.getByRole('region', { name: 'Диаграмма Ганта' })).toHaveCount(0);
  });

  test('строка называет позицию: у заказа их несколько', async ({ page }) => {
    /**
     * Шапка карточки общая на ЗАКАЗ, а этапы принадлежат позициям, и каждая
     * идёт своим маршрутом. Без имени позиции две строки «Закрой» под одним
     * заголовком читаются как дубль — это рубашка и фартук.
     */
    await page.goto('/gantt?studio=0&from=2026-07-06&days=30');
    const card = page.getByRole('listitem').filter({ hasText: 'Форма официантов' });
    await expect(card).toBeVisible();
    await expect(card.getByText(/Рубашка · 50 шт/).first()).toBeVisible();
    await expect(card.getByText(/Фартук · 30 шт/).first()).toBeVisible();
  });

  test('страница не прокручивается по горизонтали', async ({ page }) => {
    await page.goto('/gantt?studio=0&from=2026-07-06&days=30');
    await expect(page.getByRole('list', { name: 'Этапы во времени' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

/**
 * ЖЕСТЫ ПЛАНШЕТА (приёмы bencho.dev, 12.09).
 *
 * ПОЧЕМУ ИМЕННО ЗДЕСЬ, А НЕ В UNIT. Механику держат unit-сторожа: кривая
 * разгона свипа (`utils/stepperSweep.test.ts`), порог протяжки
 * (`ConfirmDialog.test.jsx`), разведение с перетаскиванием
 * (`usePullToRefresh.test.jsx`). Чего они не видят по построению — ПОПАДАЕТ ЛИ
 * ОРГАН УПРАВЛЕНИЯ ПОД ПАЛЕЦ на настоящей раскладке: в jsdom нет ни геометрии,
 * ни `pointer: coarse`. Это и проверяется здесь, на 768×1024 с `hasTouch`.
 *
 * ⚠️ БЕЗ `toHaveScreenshot`. Эталоны порождаются браузером ТОЙ ЖЕ сборки,
 * что их проверяет, а локально стоит симлинк 1194 под путями 1208 — новый
 * эталон молча разошёлся бы с CI (инцидент 06.09). Проверяются свойства:
 * что отрисовано, какого размера, что делает.
 */
test.describe('Жесты планшета', () => {
  test.beforeEach(async ({ page }) => {
    await installSupabaseMock(page);
    await page.clock.setFixedTime(FIXED_TIME);
  });

  /**
   * Степпер достижим из очереди: «В план» открывает `PlanAddModal`, где
   * «Количество на день» теперь с кнопками ±.
   */
  test('числовое поле получает кнопки ± не мельче 44px', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();

    await page.getByRole('button', { name: 'В план' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const minus = dialog.getByRole('button', { name: 'Уменьшить' });
    const plus = dialog.getByRole('button', { name: 'Увеличить' });
    await expect(minus).toBeVisible();
    await expect(plus).toBeVisible();

    const viewport = page.viewportSize()!;
    for (const btn of [minus, plus]) {
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      // Правило ≥44px — и по ОБЕИМ сторонам: узкая кнопка высотой 44
      // под палец всё равно не попадает
      expect(box!.height, 'высота кнопки шага').toBeGreaterThanOrEqual(44);
      expect(box!.width, 'ширина кнопки шага').toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });

  test('тап по ± меняет значение, поле остаётся доступным для набора', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'В план' }).first().click();

    const dialog = page.getByRole('dialog');
    const field = dialog.getByLabel('Количество на день');
    await expect(field).toBeVisible();
    const before = Number(await field.inputValue());

    await dialog.getByRole('button', { name: 'Увеличить' }).click();
    await expect(field).toHaveValue(String(before + 1));

    // Поле НЕ подпись: для больших чисел набрать быстрее, чем свайпнуть
    await field.fill('42');
    await expect(field).toHaveValue('42');
  });

  test('степпер не ломает раскладку формы', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'В план' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  /**
   * ПРОТЯЖКА ВМЕСТО ТАПА — у необратимого действия и только под пальцем.
   *
   * «Завершить этап» при неполном факте идёт через `confirmStageDone`,
   * то есть через danger-подтверждение: на тач-вводе оно показывает трек,
   * а не кнопку.
   */
  test('опасное подтверждение под пальцем — протяжка, а не кнопка', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();

    const done = page.getByRole('button', { name: /^Завершить этап/ }).first();
    await expect(done).toBeVisible();
    await done.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Подсказка про жест видна — без неё трек читается как неработающая кнопка
    await expect(dialog.getByText(/Проведите до конца/)).toBeVisible();

    // Текст последствий остался: протяжка заменяет кнопку, а не объяснение
    await expect(dialog.getByText(/будут записаны как выполненные/)).toBeVisible();
  });

  test('трек протяжки влезает в экран и не мельче 44px', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    await page.getByRole('button', { name: /^Завершить этап/ }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const track = dialog.getByRole('button', { name: 'Завершить' });
    await expect(track).toBeVisible();

    const viewport = page.viewportSize()!;
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height, 'высота трека').toBeGreaterThanOrEqual(44);
    // Протяжке нужен ХОД: на узком треке порог берётся случайным сдвигом
    expect(box!.width, 'ход трека').toBeGreaterThanOrEqual(200);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  });

  /**
   * КЛАВИАТУРНЫЙ ПУТЬ ОБЯЗАТЕЛЕН (WCAG 2.1.1) и проверяется ЗДЕСЬ, потому что
   * именно на тач-раскладке кнопка подменяется треком: не будь у трека
   * Enter — подтвердить с подключённой к планшету клавиатуры стало бы нельзя.
   */
  test('протяжку можно подтвердить с клавиатуры', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();
    await page.getByRole('button', { name: /^Завершить этап/ }).first().click();

    const dialog = page.getByRole('dialog');
    const track = dialog.getByRole('button', { name: 'Завершить' });
    await expect(track).toBeVisible();

    await track.press('Enter');
    // Диалог закрылся — действие ушло в стор
    await expect(dialog).toHaveCount(0);
  });

  test('на десктопе опасное подтверждение остаётся кнопкой', async ({ browser }) => {
    /**
     * Обратная половина гейта, и без неё проверка выше ничего не значит:
     * трек, показанный ВСЕГДА, прошёл бы все тесты этого блока. Своя страница
     * без `hasTouch` — это и есть «мышь».
     */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: false });
    const p = await ctx.newPage();
    await installSupabaseMock(p);
    await p.clock.setFixedTime(FIXED_TIME);
    await p.goto('/queue/cutting?studio=0');

    /*
     * На десктопе очередь рисует СТРОКУ, а не карточку, и действия в ней
     * скрыты до раскрытия — в этом и разница раскладок. Раскрываются ВСЕ
     * строки, а не первая: у разных этапов разные действия, и «первая»
     * оказывалась `ready` с одним «Взять в работу». Две предыдущие редакции
     * падали по таймауту именно на этом — то есть проверяли не ту половину
     * гейта, а отсутствие кнопки не на том этапе.
     */
    const expanders = p.getByRole('button', { name: 'Развернуть задание' });
    await expect(expanders.first()).toBeVisible();
    /*
     * ⚠️ НАБОР СЖИМАЕТСЯ ПОД ЛОКАТОРОМ: клик меняет подпись кнопки на
     * «Свернуть задание», то есть она ВЫХОДИТ из выборки. Снятый заранее
     * `count()` с `nth(i)` поэтому и падал — третья редакция этого теста.
     * Берём всегда первую, пока они есть; потолок — от бесконечного цикла,
     * если подпись когда-нибудь перестанет меняться.
     */
    for (let guard = 0; guard < 20 && await expanders.count() > 0; guard += 1) {
      await expanders.first().click();
    }
    await p.getByRole('button', { name: /^Завершить этап/ }).first().click();
    const dialog = p.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Проведите до конца/)).toHaveCount(0);
    await ctx.close();
  });

  /**
   * ПОТЯНУТЬ — ОБНОВИТЬ. Проверяется видимая половина: полоса называет
   * состояние. Механику (порог, сопротивление, разведение с перетаскиванием)
   * держит `usePullToRefresh.test.jsx`.
   */
  test('протяжка сверху показывает полосу обновления', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    await expect(page.locator('[class*="queueCard"]').first()).toBeVisible();

    const main = page.locator('#main-content');
    const box = (await main.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 12;

    // Настоящий жест пальцем: hasTouch у проекта включён, поэтому
    // pointerType приходит 'touch' — на мыши хук не отвечает вовсе
    await page.dispatchEvent('#main-content', 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, isPrimary: true });
    await page.dispatchEvent('#main-content', 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y + 60, isPrimary: true });

    await expect(page.getByText(/Потяните, чтобы обновить/)).toBeVisible();

    // Дотянули за порог — полоса меняет слово, а не только цвет
    await page.dispatchEvent('#main-content', 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y + 260, isPrimary: true });
    await expect(page.getByText(/Отпустите, чтобы обновить/)).toBeVisible();

    await page.dispatchEvent('#main-content', 'pointerup', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y + 260, isPrimary: true });
    // Полоса ушла: жест завершён
    await expect(page.getByText(/Потяните, чтобы обновить|Отпустите, чтобы обновить/)).toHaveCount(0);
  });

  test('полоса обновления не сдвигает содержимое', async ({ page }) => {
    await page.goto('/queue/cutting?studio=0');
    const card = page.locator('[class*="queueCard"]').first();
    await expect(card).toBeVisible();

    const before = (await card.boundingBox())!;
    const main = page.locator('#main-content');
    const box = (await main.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + 12;

    await page.dispatchEvent('#main-content', 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, isPrimary: true });
    await page.dispatchEvent('#main-content', 'pointermove', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y + 200, isPrimary: true });
    await expect(page.getByText(/Отпустите, чтобы обновить/)).toBeVisible();

    /**
     * Полоса лежит НАКЛАДКОЙ: содержимое не едет. Сдвиг меряет и
     * `erp-cls.spec.ts`, но там жеста нет — а уезжающая из-под пальца
     * кнопка этапа в этом проекте уже была отдельной жалобой.
     */
    const after = (await card.boundingBox())!;
    expect(Math.abs(after.y - before.y), 'карточка не должна уезжать').toBeLessThanOrEqual(1);

    await page.dispatchEvent('#main-content', 'pointerup', { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y + 200, isPrimary: true });
  });
});
