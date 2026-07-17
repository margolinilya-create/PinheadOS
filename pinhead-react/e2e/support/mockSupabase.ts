/**
 * Детерминированный мок Supabase для visual-регрешн-тестов.
 *
 * Зачем: продакшн-сборка не запускает dev-автологин, а без Supabase-ключей
 * (репозиторий публичный) любой экран сводился к форме логина. Здесь мы гоняем
 * visual против dev-сервера (автологин админом «Dev Mode») и перехватываем ВСЕ
 * сетевые запросы Supabase на уровне Playwright, отдавая фиксированные фикстуры.
 *
 * Реального обращения к БД нет: `page.route('** /rest/v1/**')` ловит запросы
 * независимо от хоста (реальный проект локально или dummy-хост в CI), realtime
 * websocket глушится, storage/auth отвечают заглушками. Все даты — фиксированные
 * ISO (плюс page.clock.setFixedTime в спеке), чтобы скриншоты не дрейфовали.
 */
import type { Page, Route } from '@playwright/test';
import { DEPARTMENTS } from '../../src/erp/data/departments';

// Фиксированные метки времени — никаких «сегодня» в фикстурах.
const CREATED = '2026-07-10T08:00:00Z';
const STARTED = '2026-07-16T09:00:00Z';
const FINISHED = '2026-07-17T15:00:00Z';

/** Цеха: зеркало seed-справочника со стабильными id `dep-<code>`. */
const departmentsFx = DEPARTMENTS.map((d) => ({
  id: `dep-${d.code}`,
  code: d.code,
  name: d.name,
  type: d.type,
  sort_order: d.order,
  is_branding: Boolean(d.is_branding),
  active: true,
  created_at: CREATED,
  updated_at: CREATED,
}));

const deptId = (code: string) => `dep-${code}`;

type StageSpec = {
  code: string;
  status: 'waiting' | 'ready' | 'in_progress' | 'done' | 'skipped' | 'blocked';
  qty_done?: number;
  /** Индексы этапов этой же позиции (depends_on по id) */
  deps?: number[];
};

/** Собирает этапы позиции, проставляя depends_on реальными id зависимостей. */
function buildStages(itemId: string, specs: StageSpec[]) {
  const ids = specs.map((_, i) => `${itemId}-st${i + 1}`);
  return specs.map((s, i) => ({
    id: ids[i],
    item_id: itemId,
    department_id: deptId(s.code),
    depends_on: (s.deps ?? []).map((d) => ids[d]),
    status: s.status,
    qty_done: s.qty_done ?? 0,
    qty_rework: 0,
    planned_start: null,
    planned_end: null,
    started_at: s.status === 'in_progress' || s.status === 'done' ? STARTED : null,
    finished_at: s.status === 'done' ? FINISHED : null,
    assignee: null,
    block_reason: null,
    notes: null,
    sort_order: (i + 1) * 10,
    created_at: CREATED,
    updated_at: CREATED,
  }));
}

/**
 * 4 заказа, наполняющих все ERP-экраны содержательным UI:
 * - A: просрочен, шелкография в работе (загрузка цехов, горящие сроки)
 * - B: срочный, закрой в работе + готовый к работе (Мой цех: 3 группы)
 * - C: ДТФ в работе (ещё цех в загрузке)
 * - D: все этапы готовы → «Готов к отгрузке» (KPI + фильтр)
 */
const ORDERS = [
  {
    id: 'ord-a',
    bitrix_id: '54766',
    title: 'BOX39 худи чёрные',
    manager: 'Анна',
    launch_date: '2026-07-10',
    due_date: '2026-07-18',
    buffer_days: 2,
    priority: 0,
    status: 'active',
    shipped_status: 'not_shipped',
    delivered_at: null,
    shipped_at: null,
    shipped_by: null,
    notes: 'Срочный тираж к открытию',
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
        id: 'ord-a-i1',
        order_id: 'ord-a',
        product_type: 'Худи',
        variant: 'чёрные',
        qty: 200,
        production_type: 'sewing',
        branding_methods: ['silkscreen'],
        branding_on: 'cut',
        notes: 'Плотный футер, усиленная горловина',
        size_grid: [{ color: 'чёрный', sizes: { S: 40, M: 60, L: 60, XL: 40 } }],
        sort_order: 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-a-i1', [
          { code: 'supply', status: 'done' },
          { code: 'cutting', status: 'done', deps: [0] },
          { code: 'silkscreen', status: 'in_progress', qty_done: 80, deps: [1] },
          { code: 'sewing', status: 'waiting', deps: [2] },
          { code: 'vto', status: 'waiting', deps: [3] },
        ]),
        prints: [
          {
            id: 'ord-a-i1-p1',
            item_id: 'ord-a-i1',
            seq: 1,
            method: 'silkscreen',
            fabric: null,
            zone: 'Спина по центру',
            width_mm: 250,
            height_mm: 300,
            offset_note: '80 мм от горловины',
            pantone: '1795 C',
            special: null,
            comment: 'Логотип BOX39',
            created_at: CREATED,
          },
        ],
      },
    ],
    materials: [
      {
        id: 'ord-a-m1', order_id: 'ord-a', item_id: null, kind: 'fabric',
        name: 'Футер 3-нитка, чёрный', source: 'purchase', qty: '120 кг',
        status: 'received', eta_date: null, received_at: CREATED, notes: null,
        created_at: CREATED, updated_at: CREATED,
      },
      {
        id: 'ord-a-m2', order_id: 'ord-a', item_id: null, kind: 'labels',
        name: 'Бирки тканые', source: 'purchase', qty: '200 шт',
        status: 'received', eta_date: null, received_at: CREATED, notes: null,
        created_at: CREATED, updated_at: CREATED,
      },
    ],
    attachments: [],
  },
  {
    id: 'ord-b',
    bitrix_id: '54900',
    title: 'Форма официантов «Веранда»',
    manager: 'Пётр',
    launch_date: '2026-07-12',
    due_date: '2026-07-22',
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
    stickers: 'none',
    stickers_note: null,
    no_chestny_znak: false,
    created_by: null,
    created_at: CREATED,
    updated_at: CREATED,
    items: [
      {
        id: 'ord-b-i1',
        order_id: 'ord-b',
        product_type: 'Рубашка',
        variant: 'белые',
        qty: 50,
        production_type: 'sewing',
        branding_methods: ['embroidery'],
        branding_on: 'finished',
        notes: null,
        size_grid: [{ color: 'белый', sizes: { S: 15, M: 20, L: 15 } }],
        sort_order: 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-b-i1', [
          { code: 'supply', status: 'done' },
          { code: 'cutting', status: 'in_progress', qty_done: 20, deps: [0] },
          { code: 'sewing', status: 'waiting', deps: [1] },
          { code: 'vto', status: 'waiting', deps: [2] },
          { code: 'embroidery', status: 'waiting', deps: [3] },
        ]),
        prints: [
          {
            id: 'ord-b-i1-p1',
            item_id: 'ord-b-i1',
            seq: 1,
            method: 'embroidery',
            fabric: null,
            zone: 'Грудь слева',
            width_mm: 70,
            height_mm: 70,
            offset_note: null,
            pantone: null,
            special: null,
            comment: 'Логотип ресторана',
            created_at: CREATED,
          },
        ],
      },
      {
        id: 'ord-b-i2',
        order_id: 'ord-b',
        product_type: 'Фартук',
        variant: 'хаки',
        qty: 30,
        production_type: 'cut',
        branding_methods: [],
        branding_on: 'cut',
        notes: null,
        size_grid: null,
        sort_order: 20,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-b-i2', [
          { code: 'supply', status: 'done' },
          { code: 'cutting', status: 'waiting', deps: [0] },
        ]),
        prints: [],
      },
    ],
    materials: [
      {
        id: 'ord-b-m1', order_id: 'ord-b', item_id: null, kind: 'fabric',
        name: 'Оксфорд, белый', source: 'stock', qty: '80 м',
        status: 'received', eta_date: null, received_at: CREATED, notes: null,
        created_at: CREATED, updated_at: CREATED,
      },
    ],
    attachments: [],
  },
  {
    id: 'ord-c',
    bitrix_id: '55010',
    title: 'Мерч конференции DevConf',
    manager: 'Ольга',
    launch_date: '2026-07-14',
    due_date: '2026-07-30',
    buffer_days: 3,
    priority: 0,
    status: 'active',
    shipped_status: 'not_shipped',
    delivered_at: null,
    shipped_at: null,
    shipped_by: null,
    notes: null,
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
        id: 'ord-c-i1',
        order_id: 'ord-c',
        product_type: 'Футболка',
        variant: 'белые',
        qty: 300,
        production_type: 'ready_garment',
        branding_methods: ['dtf'],
        branding_on: 'finished',
        notes: null,
        size_grid: [{ color: 'белый', sizes: { M: 120, L: 120, XL: 60 } }],
        sort_order: 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-c-i1', [
          { code: 'supply', status: 'done' },
          { code: 'dtf', status: 'in_progress', qty_done: 150, deps: [0] },
        ]),
        prints: [
          {
            id: 'ord-c-i1-p1',
            item_id: 'ord-c-i1',
            seq: 1,
            method: 'dtf',
            fabric: null,
            zone: 'Грудь по центру',
            width_mm: 200,
            height_mm: 200,
            offset_note: null,
            pantone: null,
            special: null,
            comment: 'Полноцвет',
            created_at: CREATED,
          },
        ],
      },
    ],
    materials: [
      {
        id: 'ord-c-m1', order_id: 'ord-c', item_id: null, kind: 'other',
        name: 'Готовые футболки, белые', source: 'purchase', qty: '300 шт',
        status: 'received', eta_date: null, received_at: CREATED, notes: null,
        created_at: CREATED, updated_at: CREATED,
      },
    ],
    attachments: [],
  },
  {
    id: 'ord-d',
    bitrix_id: '55120',
    title: 'Шопперы эко «Маркет»',
    manager: 'Анна',
    launch_date: '2026-07-08',
    due_date: '2026-07-25',
    buffer_days: 2,
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
    created_at: CREATED,
    updated_at: CREATED,
    items: [
      {
        id: 'ord-d-i1',
        order_id: 'ord-d',
        product_type: 'Шоппер',
        variant: 'суровый',
        qty: 100,
        production_type: 'cut',
        branding_methods: [],
        branding_on: 'cut',
        notes: null,
        size_grid: null,
        sort_order: 10,
        created_at: CREATED,
        updated_at: CREATED,
        stages: buildStages('ord-d-i1', [
          { code: 'supply', status: 'done' },
          { code: 'cutting', status: 'done', deps: [0] },
        ]),
        prints: [],
      },
    ],
    materials: [
      {
        id: 'ord-d-m1', order_id: 'ord-d', item_id: null, kind: 'fabric',
        name: 'Хлопок суровый', source: 'stock', qty: '60 м',
        status: 'received', eta_date: null, received_at: CREATED, notes: null,
        created_at: CREATED, updated_at: CREATED,
      },
    ],
    attachments: [],
  },
];

/** Данные по таблице REST-запроса с учётом простых фильтров id/status. */
function dataForTable(table: string, params: URLSearchParams): unknown[] {
  switch (table) {
    case 'erp_departments':
      return departmentsFx;
    case 'erp_orders': {
      const idFilter = params.get('id');
      const statusFilter = params.get('status');
      if (idFilter?.startsWith('eq.')) {
        const id = idFilter.slice(3);
        return ORDERS.filter((o) => o.id === id);
      }
      if (statusFilter === 'eq.active') return ORDERS.filter((o) => o.status === 'active');
      if (statusFilter?.startsWith('neq.')) return ORDERS.filter((o) => o.status !== 'active');
      return ORDERS;
    }
    // Order Studio и прочие таблицы: пустой набор → компоненты берут дефолты/пустые списки.
    default:
      return [];
  }
}

/**
 * Ставит все перехватчики Supabase на страницу. Вызывать в beforeEach ДО goto.
 */
export async function installSupabaseMock(page: Page): Promise<void> {
  // Realtime websocket — глушим, чтобы не коннектиться к реальному серверу.
  await page.routeWebSocket(/realtime/, () => {
    /* mock-режим: к серверу не подключаемся, событий нет */
  });

  // Auth — заглушка (dev-автологин выставляет пользователя без сети).
  await page.route('**/auth/v1/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  // Storage — заглушка (в фикстурах нет вложений; сломанные картинки детерминированы).
  await page.route('**/storage/v1/**', (route: Route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

  // REST (PostgREST) — фикстуры по таблице.
  await page.route('**/rest/v1/**', (route: Route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? '';
    const accept = route.request().headers()['accept'] ?? '';
    const single = accept.includes('vnd.pgrst.object');
    const data = dataForTable(table, url.searchParams);
    const body = single ? JSON.stringify(data[0] ?? null) : JSON.stringify(data);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': `0-${Math.max(data.length - 1, 0)}/*` },
      body,
    });
  });
}
