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
import { DEPARTMENTS, isQueueDept } from '../../src/erp/data/departments';

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
  // Признак производственного участка приходит из БД (правится в админке);
  // в фикстуре зеркалим сид-набор кодов
  is_production: isQueueDept(d.code),
  // ОТК деактивирован миграцией 20260810140000 (правки 10.08): участок остаётся
  // строкой ради истории, но из меню, очередей и канбана уходит по флагу `active`.
  // Фикстура — зеркало БД, и держать здесь активный ОТК значит гонять visual
  // против состояния, которого в проде уже нет.
  active: d.code !== 'qc',
  created_at: CREATED,
  updated_at: CREATED,
}));

/** Идентификатор цеха в фикстурах — им же пользуются добавки спек */
export const deptId = (code: string) => `dep-${code}`;

/** Фиксированное «когда» для добавок: даты в фикстурах не дрейфуют */
export const FX_CREATED = CREATED;

type StageSpec = {
  code: string;
  status: 'waiting' | 'ready' | 'in_progress' | 'done' | 'skipped' | 'blocked';
  qty_done?: number;
  /**
   * Подрядность ЭТАПА. Читается всегда по `executor === 'contractor'`, никогда
   * по коду участка: этапы, заведённые до 21.08, стоят на реальном цехе,
   * и отбор по коду вернул бы их в очередь этого цеха.
   */
  executor?: 'internal' | 'contractor';
  contractor?: string;
  operation?: string;
  /** Индексы этапов этой же позиции (depends_on по id) */
  deps?: number[];
  /**
   * Происхождение этапа: `experimental` — работа над образцом. В маршрутную
   * логику признак не входит, но по нему отбираются внутренние представления
   * экс-цеха и ставится пометка «ЭКС / ОБРАЗЕЦ» в общем цехе.
   */
  origin?: 'production' | 'experimental';
};

/** Собирает этапы позиции, проставляя depends_on реальными id зависимостей. */
export function buildStages(itemId: string, specs: StageSpec[]) {
  const ids = specs.map((_, i) => `${itemId}-st${i + 1}`);
  return specs.map((s, i) => ({
    id: ids[i],
    item_id: itemId,
    department_id: deptId(s.code),
    depends_on: (s.deps ?? []).map((d) => ids[d]),
    status: s.status,
    origin: s.origin ?? 'production',
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
    executor: s.executor ?? 'internal',
    contractor: s.contractor ?? null,
    operation: s.operation ?? null,
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

/**
 * ТЗ в PDF: у заказа B один общий PDF на весь заказ (`item_id = null`) — его видят
 * все производственные цеха обеих позиций без каких-либо назначений. Так задание цеха
 * показывает документ, а гейт «не загружено ТЗ» не стопорит фикстуру.
 * Остальные заказы — «до внедрения ТЗ» (tz_required не задан).
 */
const TZ_DOC = {
  id: 'tz-b-1',
  order_id: 'ord-b',
  item_id: null,
  group_id: 'tz-grp-b',
  version: 1,
  is_current: true,
  file_path: 'tz/ord-b/tz-grp-b/v1-Форма официантов.pdf',
  file_name: 'Форма официантов.pdf',
  mime_type: 'application/pdf',
  size_bytes: 245000,
  note: null,
  uploaded_by: 'Пётр',
  created_at: CREATED,
};

{
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const orderB = ORDERS.find((o) => o.id === 'ord-b') as any;
  orderB.tz_required = true;
  orderB.tz_documents = [TZ_DOC];
}

/**
 * Производственный план (правка менеджера 2026-08-03): неделя фиксированного
 * времени фикстур — понедельник 20.07.2026. Раскладываем закрой заказа B
 * на два дня, чтобы экран показал и полный день, и недовыполнение.
 */
const PLAN_SLOTS = [
  {
    id: 'plan-1', department_id: 'dep-cutting', stage_id: 'ord-b-i1-st2',
    work_date: '2026-07-20', qty_planned: 30, qty_done: 20, qty_defect: 0,
    assignee: null, status: 'confirmed', comment: 'сначала белые',
    fact_comment: null, deviation_reason: 'не хватило ткани',
    fact_by: 'Мастер', fact_at: '2026-07-20T15:00:00Z', created_by: 'Пётр',
    sort_order: 1000, priority: 1,
    problem_type: null, problem_note: null,
    problem_affects_due: false, problem_needs_help: false, problem_can_continue: true,
    created_at: CREATED, updated_at: CREATED,
  },
  {
    id: 'plan-2', department_id: 'dep-cutting', stage_id: 'ord-b-i2-st2',
    work_date: '2026-07-21', qty_planned: 20, qty_done: 0, qty_defect: 0,
    assignee: null, status: 'planned', comment: null,
    fact_comment: null, deviation_reason: null,
    fact_by: null, fact_at: null, created_by: 'Пётр',
    sort_order: 1000, priority: 0,
    problem_type: null, problem_note: null,
    problem_affects_due: false, problem_needs_help: false, problem_can_continue: true,
    created_at: CREATED, updated_at: CREATED,
  },
];

/**
 * Добавки к фикстурам — ТОЛЬКО для своей спеки.
 *
 * Базовый набор из четырёх заказов держит visual-снапшоты и счётчики
 * в `erp-queue`/`erp-plan`: дописать туда пятый заказ ради одной проверки
 * значит перекрасить эталоны половины прогона. Поэтому спека, которой нужны
 * СВОИ данные, передаёт их сюда, а всем остальным мир остаётся прежним.
 */
export type MockExtras = {
  /** Заказы, добавляемые к базовым четырём */
  orders?: unknown[];
  /**
   * Разработки ЭКС (с эмбедом `tasks` и `order`).
   *
   * ТРЕТИЙ ПУТЬ К ТЕМ ЖЕ СТРОКАМ ЕСТЬ, И ОН ЖИВЁТ НЕ ЗДЕСЬ (правки 02.09,
   * п. 2): гейт отгрузки судит по эмбеду `developments` ВНУТРИ заказа,
   * а не по этому списку. Мок ничего не «джойнит» — фикстура заказа несёт
   * ключ `developments` сама, ровно как его отдаёт PostgREST. Сказано вслух,
   * чтобы следующий не искал здесь несуществующую сборку связи.
   */
  experimental?: unknown[];
  /** Значения справочников — приезжают пакетом оболочки */
  dictionaries?: unknown[];
  /**
   * Карточки подрядчика при этапах (`erp_subcontracting`).
   *
   * Приезжают ДВУМЯ путями, как и разработки: пакетом оболочки и отдельным
   * запросом `loadSubcontracting`. Мок обязан повторять оба — иначе экран
   * «Подряд» показывал бы «подрядных этапов нет» при заполненной таблице,
   * то есть проверялся бы не тот путь, по которому ходит прод.
   */
  subcontracting?: unknown[];
  /**
   * Сотрудники и учётные записи админки (`erp_employees` + `profiles`).
   *
   * Списки разные и в базе, и на экране: профиль это учётная запись с ролью
   * и статусом, `erp_employees` — цеховая надстройка над ним ЛИБО работник
   * без логина вовсе. Экран показывает их двумя таблицами, поэтому и здесь
   * два ключа: набор, где всё связано, не дал бы проверить нижнюю таблицу.
   */
  employees?: unknown[];
  profiles?: unknown[];
  /**
   * Задержать СОСТАВ УЧАСТКОВ до тех пор, пока спека сама его не отпустит.
   *
   * Нужен сторожу раскладки (`erp-cls.spec.ts`): чтобы доказать, что место под
   * список цехов зарезервировано, надо снять геометрию В СОСТОЯНИИ «данные ещё
   * не приехали». Задержкой в миллисекундах это не делается — остаётся окно,
   * в котором пакет успевает ответить до замера, и сторож ЗЕЛЕНЕЕТ НА СЛОМАННОМ
   * КОДЕ, то есть перестаёт быть сторожем.
   *
   * Держит не эндпойнт, а величину: у `departments` ДВА писателя — пакет
   * оболочки `erp_bootstrap` и отдельная выборка `erp_departments` внутри
   * `loadAll` (ordersSlice: запрашивает цеха, если их ещё нет). Гейт на одном
   * RPC состояния «до» не создал бы вовсе — цеха приехали бы вторым путём.
   */
  deptsGate?: Promise<void>;
};

type OrderFx = { id: string; bitrix_id: string; status: string; is_demo?: boolean };

/** Данные по таблице REST-запроса с учётом простых фильтров id/status. */
function dataForTable(table: string, params: URLSearchParams, extra: MockExtras): unknown[] {
  switch (table) {
    case 'erp_departments':
      return departmentsFx;
    case 'erp_experimental':
      // Разработки приезжают и пакетом оболочки, и этим запросом — на проде
      // это один и тот же набор, и мок обязан повторять именно так
      return extra.experimental ?? [];
    case 'erp_subcontracting':
      return extra.subcontracting ?? [];
    case 'erp_employees':
      return extra.employees ?? [];
    case 'profiles':
      return extra.profiles ?? [];
    case 'erp_orders': {
      const all = [...ORDERS, ...((extra.orders ?? []) as typeof ORDERS)] as unknown as OrderFx[];
      const idFilter = params.get('id');
      const statusFilter = params.get('status');
      if (idFilter?.startsWith('eq.')) {
        const id = idFilter.slice(3);
        return all.filter((o) => o.id === id);
      }
      const bitrixFilter = params.get('bitrix_id');
      if (bitrixFilter?.startsWith('eq.')) {
        const value = bitrixFilter.slice(3);
        return all.filter((o) => o.bitrix_id === value);
      }
      // Демо отсекается В ЗАПРОСЕ (аудит 03.08.2026) — мок обязан это повторять,
      // иначе e2e проверяет путь, которого в приложении больше нет.
      const demoFilter = params.get('is_demo');
      let rows = all;
      if (demoFilter === 'eq.false') rows = rows.filter((o) => !o.is_demo);
      if (statusFilter === 'eq.active') return rows.filter((o) => o.status === 'active');
      if (statusFilter?.startsWith('neq.')) return rows.filter((o) => o.status !== 'active');
      return rows;
    }
    /**
     * Задачи плана. Фильтры по дате и статусу мок ОБЯЗАН повторять: очередь
     * «Не запланировано» (правки 10.08) спрашивает «что стоит в плане с сегодня
     * и дальше», и мок, отдающий всё подряд, показывал бы запланированным то,
     * что было в прошлом месяце, — то есть проверял бы не тот путь, по которому
     * ходит прод.
     */
    case 'erp_calendar_slots': {
      let rows = PLAN_SLOTS;
      const from = params.get('work_date');
      // PostgREST шлёт повторяющийся ключ: work_date=gte.X&work_date=lte.Y
      for (const raw of params.getAll('work_date')) {
        if (raw.startsWith('gte.')) rows = rows.filter((s) => s.work_date >= raw.slice(4));
        if (raw.startsWith('lte.')) rows = rows.filter((s) => s.work_date <= raw.slice(4));
      }
      void from;
      const status = params.get('status');
      if (status?.startsWith('neq.')) rows = rows.filter((s) => s.status !== status.slice(4));
      return rows;
    }
    /**
     * Мощность производства (правки 10.08). Без строки полоса загрузки честно
     * писала бы «мощность не задана» — путь тоже рабочий, но e2e должен гонять
     * основной: 10 000 единиц из документа заказчика.
     */
    case 'erp_settings':
      return [{
        key: 'production_capacity',
        value: { monthly_units: 10000, work_days_per_week: 5 },
        updated_by: null, updated_by_id: null, updated_at: CREATED,
      }];
    // Order Studio и прочие таблицы: пустой набор → компоненты берут дефолты/пустые списки.
    default:
      return [];
  }
}

/**
 * Ответы на RPC-пакеты страницы (аудит 03.08.2026): `erp_bootstrap` собирает
 * данные оболочки одним запросом вместо шести, `erp_order_detail` — спутники
 * карточки вместо трёх.
 *
 * Без них мок отдавал на RPC пустой массив, приложение получало `undefined`
 * вместо цехов и держалось только на запасном пути в `loadAll`. То есть e2e
 * проверял НЕ ТОТ путь, по которому ходит прод.
 */
/**
 * Задачи разработки, заведённые ПО ХОДУ прогона.
 *
 * МОК ОБЯЗАН УМЕТЬ ТО, ЧТО УМЕЕТ КЛИЕНТ (правило проекта). Раньше
 * `erp_experimental_add_tasks` и `erp_experimental_task_send` попадали
 * в `default: null`, и вход карточки в «Нанесения» в e2e не заводил НИ ОДНОЙ
 * задачи: колонка менялась, работа в цех не уезжала, а `sendDevTaskToDept`
 * молча отвечал ошибкой. Проверить «пока цех не закрыл — дальше нельзя» было
 * попросту нечем, потому что незакрытых задач не существовало.
 *
 * Состояние держится здесь, а не в фикстуре: `task_send` получает только id
 * задачи, а `patchTaskIn` в сторе ЗАМЕНЯЕТ строку целиком — вернув огрызок,
 * мок стёр бы `task_type`, и задача выпала бы из всех подсчётов.
 */
const createdTasks = new Map<string, Record<string, unknown>>();

function dataForRpc(fn: string, body: Record<string, unknown>, extra: MockExtras): unknown {
  switch (fn) {
    case 'erp_experimental_add_tasks': {
      const devId = String(body.p_experimental_id ?? '');
      const list = (body.p_tasks ?? []) as Record<string, unknown>[];
      return list.map((t, i) => {
        const row = {
          id: `mock-task-${createdTasks.size + i}`,
          experimental_id: devId,
          title: null,
          responsible: null,
          due_date: null,
          status: 'todo',
          blocked_reason: null,
          depends_on: [],
          cycle: 0,
          sort_order: 100,
          qty: null,
          comment: null,
          result: null,
          department_id: null,
          stage_id: null,
          done_on: null,
          created_at: FX_CREATED,
          updated_at: FX_CREATED,
          ...t,
        };
        createdTasks.set(String(row.id), row);
        return row;
      });
    }
    case 'erp_experimental_task_send': {
      const id = String(body.p_task_id ?? '');
      const prev = createdTasks.get(id) ?? { id };
      // Ровно то, что делает серверная функция: задача уходит в цех и ждёт его
      const row = {
        ...prev,
        department_id: body.p_department_id ?? null,
        stage_id: `mock-stage-${id}`,
        qty: body.p_qty ?? (prev as { qty?: unknown }).qty ?? null,
        status: 'waiting',
      };
      createdTasks.set(id, row);
      return row;
    }
    case 'erp_bootstrap':
      return {
        departments: departmentsFx,
        permissions: [],       // пусто → клиент падает на DEFAULT_PERMISSIONS
        dictionaries: extra.dictionaries ?? [],
        subcontracting: extra.subcontracting ?? [],
        // Пакет оболочки ставит `experimentalLoaded: true`, поэтому экран
        // разработки берёт данные ОТСЮДА и второго запроса не делает.
        // Мок, отдающий здесь пусто, показывал бы «Разработок пока нет»
        // при заполненной таблице — то есть проверял бы не тот путь
        experimental: extra.experimental ?? [],
        my_employee: null,     // без привязки к цеху, как у диспетчера
      };
    case 'erp_order_detail': {
      void body;
      return { events: [], audit: [], comments: [] };
    }
    default:
      return null;
  }
}

/**
 * Ставит все перехватчики Supabase на страницу. Вызывать в beforeEach ДО goto.
 */
export async function installSupabaseMock(page: Page, extra: MockExtras = {}): Promise<void> {
  /**
   * Realtime websocket — к реальному серверу не подключаемся, но ОТВЕЧАЕМ.
   *
   * Раньше здесь стояла пустая заглушка: сокет открыт, а на `phx_join` никто
   * не отвечает. supabase-js ждёт ответа и по таймауту отдаёт `TIMED_OUT` —
   * то есть в КАЖДОМ e2e-прогоне приложение считало себя отключённым, и с
   * 22.08 (когда появился `StaleDataBar`) на каждом экране ERP висела полоса
   * «Связь с сервером потеряна». Именно она и уронила восемь визуальных
   * эталонов: они снимались до её появления.
   *
   * Узаконить полосу перегенерацией эталонов было бы хуже, чем ничего:
   * это ИНДИКАТОР ОТКАЗА, и сделав его нормой, визуальный сторож навсегда
   * перестал бы замечать «приложение всегда считает себя офлайн».
   *
   * Отвечаем минимальным Phoenix-ответом. Этого достаточно по построению
   * `RealtimeChannel.subscribe`: если в ответе нет `postgres_changes`,
   * клиент сразу переходит в `SUBSCRIBED`. Тем же ответом гасятся
   * heartbeat-сообщения — без них сокет закрылся бы по своему таймауту.
   * Событий по-прежнему нет: фикстуры статичны, реалтайм в спеках не проверяется.
   */
  await page.routeWebSocket(/realtime/, (ws) => {
    ws.onMessage((raw) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return; // не Phoenix-кадр — молчим
      }
      /**
       * Формат кадра — МАССИВ `[join_ref, ref, topic, event, payload]`
       * (сериализатор Phoenix v2), а не объект. Ответ обязан нести те же
       * `join_ref`, `ref` и `topic`, иначе клиент не сопоставит его с запросом
       * и будет перезаходить в канал по кругу — что и происходило, пока
       * ответ отправлялся объектом.
       */
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic] = frame as [string, string, string, string, unknown];
      ws.send(JSON.stringify([
        joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} },
      ]));
    });
  });

  // Auth — заглушка (dev-автологин выставляет пользователя без сети).
  await page.route('**/auth/v1/**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  // Storage — заглушка (в фикстурах нет вложений; сломанные картинки детерминированы).
  await page.route('**/storage/v1/**', (route: Route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

  /**
   * REST (PostgREST) — ОДИН перехватчик на пакеты и на таблицы.
   *
   * Раньше их было два: `**\/rest\/v1\/rpc\/**` и общий `**\/rest\/v1\/**`.
   * Playwright отдаёт запрос ПОСЛЕДНЕМУ подходящему обработчику, поэтому общий
   * затенял частный, и `erp_bootstrap` отвечал `[]` — как таблица с именем
   * `rpc/erp_bootstrap`. Пакет оболочки не срабатывал НИ РАЗУ: приложение
   * молча уходило на запасной путь `loadAll`, то есть весь e2e проверял не тот
   * путь, по которому ходит прод, — ровно то, что комментарий рядом обещал
   * не допустить.
   *
   * Два перекрывающихся шаблона чинятся не порядком регистрации (порядок
   * забывается при следующей правке), а отсутствием перекрытия: ветка одна,
   * и выбирает она по пути запроса.
   */
  await page.route('**/rest/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split('/rest/v1/')[1] ?? '';

    if (path.startsWith('rpc/')) {
      const fn = path.slice(4).split('?')[0];
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(route.request().postData() ?? '{}'); } catch { /* без тела */ }
      // Оба писателя состава участков ждут гейт — см. `deptsGate` в MockExtras
      if (fn === 'erp_bootstrap' && extra.deptsGate) await extra.deptsGate;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dataForRpc(fn, payload, extra)),
      });
    }

    const table = path.split('?')[0];
    if (table === 'erp_departments' && extra.deptsGate) await extra.deptsGate;
    const accept = route.request().headers()['accept'] ?? '';
    const single = accept.includes('vnd.pgrst.object');
    const data = dataForTable(table, url.searchParams, extra);
    const body = single ? JSON.stringify(data[0] ?? null) : JSON.stringify(data);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'content-range': `0-${Math.max(data.length - 1, 0)}/*` },
      body,
    });
  });
}
