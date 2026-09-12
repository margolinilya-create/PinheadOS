import { test } from '@playwright/test';
import { installSupabaseMock, buildStages } from '../support/mockSupabase';
import { unclampShell } from './unclamp';

/**
 * ОБХОД НА КРАЙНИХ СЛУЧАЯХ БОЕВЫХ ДАННЫХ.
 *
 * Базовые фикстуры описывают удобный мир: названия в 5–7 знаков («Худи»,
 * «Рубашка»), номер сделки из пяти цифр, у всех заказов есть менеджер и срок.
 * Прод устроен иначе — сверка с боевой базой 12.09 (21 заказ, 12 активных):
 *
 *   · название позиции доходит до 250 знаков — целое техзадание в одном поле
 *     («Блокнот А5: 148х210мм.; сборка: спироплётная пружина…»);
 *   · название заказа — до 40 знаков, в верхнем регистре целиком;
 *   · в графе «№ сделки» встречается ТЕКСТ, а не число, и он длиннее колонки;
 *   · у части заказов нет ни срока, ни менеджера;
 *   · активных участков ДВЕНАДЦАТЬ, а не семь: и список в меню, и ряд вкладок
 *     очереди длиннее, чем на любой фикстуре.
 *
 * Данные здесь ОБЕЗЛИЧЕНЫ, но длины и форма сохранены: проверяется вёрстка,
 * а не содержимое. Это стенд, а не сторож, — снимки идут в `.shots/extremes`
 * и читаются глазами (см. шапку `playwright.bench.config.ts`).
 */

const CREATED = '2026-07-01T08:00:00Z';
const FIXED_TIME = new Date('2026-07-20T09:00:00');

/** Позиция, название которой на проде занимает целый абзац */
const LONG_PRODUCT = 'Блокнот А5: 148х210мм.; сборка: спироплётная пружина чёрная, '
  + 'по длинной стороне  Обложка/подложка: 148х210мм.; без печати; дизайнерская '
  + 'бумага, 270 г/м2;  Блок: 148х210мм.; 160 полос / 80 листов; без печати; '
  + 'без покрытия офсетная, 80 г/м2';

const EXTREME_ORDERS = [
  {
    id: 'ord-x1',
    bitrix_id: '64836',
    title: 'БАЗОВЫЙ МЕРЧ ПАРТНЁРА лонгсливы Производство',
    manager: 'Александра',
    launch_date: '2026-07-11',
    due_date: '2026-07-21',
    buffer_days: 2,
    priority: 0,
    status: 'active',
    shipped_status: 'not_shipped',
    delivered_at: null,
    shipped_at: null,
    shipped_by: null,
    notes: 'Перешив и допошив по остаткам прошлой партии, цвет сверяем по утверждённому образцу',
    packaging: 'bopp',
    packaging_note: null,
    stickers: 'blank',
    stickers_note: null,
    no_chestny_znak: false,
    created_by: null,
    created_at: CREATED,
    updated_at: CREATED,
    items: [
      {
        id: 'ord-x1-i1',
        order_id: 'ord-x1',
        product_type: LONG_PRODUCT,
        variant: 'дизайнерская бумага, пружина чёрная',
        qty: 155,
        production_type: 'sewing',
        branding_methods: ['silkscreen'],
        branding_on: 'cut',
        notes: null,
        size_grid: [{ color: 'без цвета', sizes: { 'ONE SIZE': 155 } }],
        sort_order: 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-x1-i1', [
          { code: 'supply', status: 'done' },
          { code: 'cutting', status: 'in_progress', qty_done: 40, deps: [0] },
          { code: 'silkscreen', status: 'waiting', deps: [1] },
          { code: 'sewing', status: 'waiting', deps: [2] },
        ]),
        prints: [],
        materials: [],
      },
    ],
    materials: [],
    attachments: [],
    tz_documents: [],
    developments: [],
  },
  {
    // Номер сделки ТЕКСТОМ и без срока: так заводят пробные заказы,
    // и колонка «№ сделки» шириной 92px получает строку из 16 знаков
    id: 'ord-x2',
    bitrix_id: 'тест вышивка 2',
    title: 'тест экс цех повтор',
    manager: null,
    launch_date: '2026-07-12',
    due_date: null,
    buffer_days: 0,
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
    no_chestny_znak: true,
    created_by: null,
    created_at: CREATED,
    updated_at: CREATED,
    items: [
      {
        id: 'ord-x2-i1',
        order_id: 'ord-x2',
        product_type: 'Футболка',
        variant: null,
        qty: 100,
        production_type: 'sewing',
        branding_methods: ['embroidery'],
        branding_on: 'ready',
        notes: null,
        size_grid: [],
        sort_order: 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-x2-i1', [
          { code: 'supply', status: 'in_progress' },
          { code: 'embroidery', status: 'waiting', deps: [0] },
        ]),
        prints: [],
        materials: [],
      },
    ],
    materials: [],
    attachments: [],
    tz_documents: [],
    developments: [],
  },
  {
    // Пять позиций в одном заказе — максимум боевой базы
    id: 'ord-x3',
    bitrix_id: '123456',
    title: 'Образцы: набор к конференции',
    manager: 'Ирина',
    launch_date: '2026-07-10',
    due_date: '2026-07-23',
    buffer_days: 1,
    priority: 0,
    status: 'active',
    shipped_status: 'not_shipped',
    delivered_at: null,
    shipped_at: null,
    shipped_by: null,
    notes: null,
    packaging: 'zip',
    packaging_note: null,
    stickers: 'other',
    stickers_note: 'наклейка на упаковку',
    no_chestny_znak: false,
    created_by: null,
    created_at: CREATED,
    updated_at: CREATED,
    items: ['Стикерпак', 'Сумка для вещей и свэга', 'Табличка', 'БОПП-пакет с печатью', 'Блокнот']
      .map((name, i) => ({
        id: `ord-x3-i${i + 1}`,
        order_id: 'ord-x3',
        product_type: name,
        variant: null,
        qty: 1 + i,
        production_type: 'samples',
        branding_methods: [],
        branding_on: 'ready',
        notes: null,
        size_grid: [],
        sort_order: (i + 1) * 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages(`ord-x3-i${i + 1}`, [{ code: 'supply', status: 'in_progress' }]),
        prints: [],
        materials: [],
      })),
    materials: [],
    attachments: [],
    tz_documents: [],
    developments: [],
  },
];

const SHOTS: [string, string][] = [
  ['orders', '/orders'],
  ['board', '/board'],
  ['order-card', '/orders/ord-x1'],
  ['queue-cutting', '/queue/cutting'],
  ['dashboard', '/'],
  ['gantt', '/gantt'],
];

const WIDTHS = [
  { name: '1440', width: 1440, height: 900, hasTouch: false },
  { name: '768', width: 768, height: 1024, hasTouch: true },
] as const;

for (const w of WIDTHS) {
  test.describe(`крайние случаи ${w.name}`, () => {
    test.use({ viewport: { width: w.width, height: w.height }, hasTouch: w.hasTouch });

    for (const [name, path] of SHOTS) {
      test(`${name} ${w.name}`, async ({ page }) => {
        await installSupabaseMock(page, { orders: EXTREME_ORDERS });
        await page.clock.setFixedTime(FIXED_TIME);
        const sep = path.includes('?') ? '&' : '?';
        await page.goto(`${path}${sep}studio=0`);
        await page.locator('h1').first().waitFor({ timeout: 20_000 });
        await page.waitForTimeout(700);
        await page.evaluate(() => document.fonts.ready);
        await unclampShell(page);
        await page.screenshot({
          path: `.shots/extremes/${name}-${w.name}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      });
    }
  });
}
