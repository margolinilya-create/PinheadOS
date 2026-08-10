/**
 * Типы ERP — зеркало схемы erp_* в Supabase
 * (supabase/migrations/20260716140000_erp_phase1_core_schema.sql).
 *
 * Модель: заказ → позиции (изделие × вариант) → этапы (позиция × цех).
 * Статус ready вычисляется из depends_on + материалов, см. docs/erp/spreadsheet-analysis.md.
 */

// --- Справочники значений ---------------------------------------------------

export type ErpOrderStatus =
  | 'active'
  | 'done_on_time'
  | 'done_late'
  | 'done_early'
  | 'cancelled';

export type ErpShippedStatus = 'not_shipped' | 'partial' | 'shipped';

/** Тип производства позиции (лист «Маршруты») */
export type ProductionType =
  | 'no_product'     // Без изделий (только нанесение на давальческое)
  | 'ready_garment'  // Готовое изделие (закупаем готовое)
  | 'cut'            // Крой (продаём крой)
  | 'sewing'         // Пошив (полный цикл)
  | 'samples'        // Образцы
  | 'outsource';     // Подряд

export type BrandingMethod =
  | 'embroidery'     // Вышивка
  | 'silkscreen'     // Шелкография
  | 'dtf'            // ДТФ
  | 'heat_transfer'  // Термоперенос
  | 'other';         // Прочие (пришив нашивок и т.п.)

/** Нанесение на крое (до пошива) или на готовом изделии */
export type BrandingOn = 'cut' | 'finished';

export type StageStatus =
  | 'waiting'      // ждёт зависимости (крой/нанесение/пошив/материалы)
  | 'ready'        // готов к работе — можно ставить в календарь
  | 'in_progress'  // в работе
  | 'done'         // завершён
  | 'skipped'      // не нужен для этой позиции
  | 'blocked';     // ручная блокировка цехом (block_reason)

export type MaterialKind = 'fabric' | 'hardware' | 'labels' | 'packaging' | 'other';
export type MaterialSource = 'purchase' | 'stock' | 'client' | 'none';
export type MaterialStatus =
  | 'pending' | 'ordered' | 'in_transit' | 'received' | 'partial' | 'not_needed' | 'reserved';
/** Статус приёмки складом (правка 3): результат сверки план/факт */
export type MaterialAcceptStatus =
  | 'accepted_full' | 'accepted_partial' | 'shortage' | 'mismatch' | 'rejected';
/** Тип складской операции (правка 2): история сопровождения заказа складом */
export type WarehouseOpType =
  | 'material_receipt' | 'rework_receipt' | 'partial_receipt' | 'packaging' | 'shipment' | 'marking';

/** Тип задачи склада (волна 4 + правка 4.2.1): заказ проходит склад несколько раз */
export type WarehouseTaskType =
  | 'material_receipt' | 'marking' | 'fg_receipt' | 'pack_ship' | 'subcontract_receipt';
/** Статусы задач склада по типам */
export type MaterialReceiptStatus = 'awaiting' | 'accepted';
export type MarkingStatus = 'new' | 'in_progress' | 'issued';
export type PackShipStatus =
  | 'awaiting_receipt' | 'accepted' | 'packing' | 'packed' | 'ready_to_ship' | 'shipped';
/** Приёмка готовой продукции от подрядчика (правка 4.2.1) */
export type SubcontractReceiptStatus = 'awaiting_receipt' | 'accepted';
/**
 * Приёмка готовой продукции С ПРОИЗВОДСТВА (волна 3.4). Считается в ШТУКАХ
 * и пишет отчёты в тот же `erp_stage_reports`, что и цеха: «сколько изделий
 * приняли» не должно собираться из двух мест с разными правилами.
 */
export type FgReceiptStatus = 'awaiting' | 'accepted';
export type WarehouseTaskStatus =
  | MaterialReceiptStatus | MarkingStatus | PackShipStatus
  | SubcontractReceiptStatus | FgReceiptStatus;

export type SlotStatus = 'planned' | 'confirmed' | 'done' | 'moved' | 'cancelled';

// --- Строки таблиц ----------------------------------------------------------

/** Куда попадает число поля: в колонку журнала или в свободный `extra` */
export type ResultFieldTarget =
  | 'qty_good' | 'qty_defect' | 'qty_rework' | 'qty_extra' | 'extra';

/** Одно поле отчёта участка (схема живёт в `erp_departments.result_fields`) */
export interface ResultField {
  code: string;
  label: string;
  unit?: string | null;
  required?: boolean;
  target: ResultFieldTarget;
}

export const RESULT_FIELD_TARGET_LABELS: Record<ResultFieldTarget, string> = {
  qty_good: 'Сделано (идёт в прогресс этапа)',
  qty_defect: 'Брак',
  qty_rework: 'В переделку',
  qty_extra: 'Сверх тиража',
  extra: 'Только в журнал',
};

/**
 * Строка журнала результатов (`erp_stage_reports`). Append-only: цех сдаёт
 * работу частями, и каждая сдача — своя строка. Итог живёт в счётчиках этапа.
 */
export interface ErpStageReport {
  id: string;
  stage_id: string | null;
  warehouse_task_id: string | null;
  /** Снимок входа: сколько цех видел принятым (считает `utils/stageInput`) */
  qty_in: number | null;
  qty_good: number;
  qty_defect: number;
  qty_rework: number;
  qty_extra: number;
  comment: string | null;
  extra: Record<string, unknown>;
  author: string | null;
  author_id: string | null;
  created_at: string;
}

export interface ErpDepartment {
  id: string;
  code: string;
  name: string;
  type: string;
  sort_order: number;
  is_branding: boolean;
  active: boolean;
  /** Руководитель цеха (правка 11) — закрепляется в админке */
  head_employee_id?: string | null;
  /** Нормативный срок этапа в днях (правка 12) — план завершения при «Взять в работу» */
  norm_days?: number | null;
  /**
   * Производственный участок: своя очередь, колонка в канбане, требует ТЗ.
   * Правится в админке — раньше набор был захардкожен, и новый цех не появлялся нигде.
   */
  is_production?: boolean;
  /**
   * Какие числа участок вносит по завершении работы (правки 10.08, P2).
   *
   * Набор полей у цехов РАЗНЫЙ, поэтому он берётся из данных, а не из кода:
   * константа «у закроя такие-то поля» не дала бы участку, заведённому
   * директором, никакого отчёта — ровно та же ошибка, что уже случилась
   * с материальным гейтом. Пусто = отчёт не требуется (fail-open).
   */
  result_fields?: ResultField[] | null;
  /**
   * Виды материалов, без которых этап участка не запускается (правка 2026-08-03).
   * Пустой массив — участок материалами не гейтится. Правится в админке;
   * раньше это была константа MATERIAL_GATE_DEPT в utils/routes.ts.
   */
  gate_material_kinds?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ErpOrder {
  id: string;
  bitrix_id: string | null;
  title: string;
  /** Клиент заказа — показывается в задании цеха и фильтруется (правки 5/9) */
  customer?: string | null;
  manager: string | null;
  launch_date: string | null;
  due_date: string | null;
  buffer_days: number;
  priority: number;
  status: ErpOrderStatus;
  shipped_status: ErpShippedStatus;
  delivered_at: string | null;
  /** Отгрузка (кнопка «Отгрузить»): когда и кто (uuid профиля; dev-режим — null) */
  shipped_at?: string | null;
  shipped_by?: string | null;
  notes: string | null;
  packaging?: PackagingType;
  packaging_note?: string | null;
  stickers?: StickersType;
  stickers_note?: string | null;
  no_chestny_znak?: boolean;
  /**
   * Требуется ли ТЗ в PDF (волна 4). Новые заказы — true (гейт на создании и на этапе).
   * Заказы, заведённые до внедрения ТЗ, — false, иначе гейт застопорил бы производство.
   */
  tz_required?: boolean;
  /**
   * Тестовый/демонстрационный заказ. По умолчанию не приезжает в списки вовсе:
   * фильтр стоит в самом запросе (`ordersSlice`), а не в каждом экране — иначе
   * пятнадцать экранов и все счётчики цехов пришлось бы чинить поштучно,
   * и один забытый показывал бы демо как боевую работу.
   */
  is_demo?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErpOrderItem {
  id: string;
  order_id: string;
  product_type: string;
  variant: string | null;
  qty: number;
  production_type: ProductionType;
  branding_methods: BrandingMethod[];
  branding_on: BrandingOn | null;
  notes: string | null;
  size_grid?: SizeGridRow[] | null;
  sort_order: number;
  /** Подряд (волна 4.2): выбирается при создании заказа с типом «Подряд» */
  subcontract_kind?: SubcontractOpType | null;
  material_source?: SubcontractMaterialSource | null;
  created_at: string;
  updated_at: string;
}

export interface ErpItemStage {
  id: string;
  item_id: string;
  department_id: string;
  depends_on: string[];
  status: StageStatus;
  qty_done: number;
  qty_rework: number;
  planned_start: string | null;
  planned_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  assignee: string | null;
  block_reason: string | null;
  notes: string | null;
  /** Порядок этапа в маршруте позиции (задаётся при создании, не меняется) */
  sort_order: number;
  /**
   * Номер прохода позиции через ЭТОТ цех (волна 3, фундамент).
   *
   * 0 — обычное производство: позиция бывает в цехе один раз. 1+ — повторные
   * заходы образца из экспериментального цеха, где «сшили → примерили →
   * переделали → сшили снова» это нормальный ход разработки, а не брак.
   * Входит в уникальность строки (`item_id, department_id, cycle`) — именно
   * прежний `unique (item_id, department_id)` и мешал моделировать образцы
   * этапами, из-за чего у эксп. цеха завелась вторая машина состояний.
   */
  cycle?: number;
  /**
   * Откуда работа (волна 3.6): `production` — серия, `experimental` — образец
   * из экспериментального цеха. Даёт бейдж «Образец» и фильтр; в маршрутную
   * логику НЕ входит — иначе цех работал бы с образцом по особым правилам,
   * а он проходит те же гейты и те же переходы.
   */
  origin?: 'production' | 'experimental';
  /**
   * Приоритет задания в очереди своего цеха (волна 1, правка 3). Меньше — выше.
   * numeric: перенос drag-and-drop пишет середину между соседями, без перенумерации.
   * null — этап ещё не получил позицию (сортируется по сроку заказа).
   */
  queue_position?: number | null;
  // Обработка просрочки (правка 8): комментарий причины задержки + время подтверждения
  overdue_comment?: string | null;
  overdue_ack_at?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Строка журнала приходов материала (`erp_material_receipts`, волна 3.3).
 * Сумма по журналу лежит в `ErpMaterial.qty_received` — её ведёт триггер.
 */
export interface ErpMaterialReceipt {
  id: string;
  material_id: string;
  qty: number;
  unit: string | null;
  accept_status: MaterialAcceptStatus;
  invoice: string | null;
  comment: string | null;
  received_on: string;
  author: string | null;
  author_id: string | null;
  created_at: string;
}

export interface ErpMaterial {
  id: string;
  order_id: string;
  item_id: string | null;
  kind: MaterialKind;
  name: string;
  source: MaterialSource;
  supplier: string | null;
  // План материала (заводит закупка; на приёмке read-only для склада, правка 4.1.3)
  role: string | null;
  color: string | null;
  article: string | null;
  qty: string | null;
  status: MaterialStatus;
  eta_date: string | null;
  received_at: string | null;
  notes: string | null;
  // Приёмка складом (правка 3 + 4.1.3): числовая сверка план/факт + фактические атрибуты
  qty_expected: number | null;
  /**
   * Принято всего — СУММА журнала `erp_material_receipts`, её ведёт триггер
   * (волна 3.3). Клиент эту колонку только читает: прямая запись означала бы
   * двух писателей, и первый же следующий приход затёр бы набранное вручную.
   */
  qty_received: number | null;
  /**
   * Единица измерения — МЕТКА для человека (кг, м, шт, уп), не коэффициент:
   * пересчёта между единицами система не делает и делать не должна —
   * плотность ткани у каждого артикула своя.
   */
  unit?: string | null;
  /**
   * Цена за единицу — снимок на момент выбора поставщика. Цена в справочнике
   * меняется, а история закупки меняться не должна. Итоговая сумма НЕ хранится:
   * хранить производную значит завести расхождение.
   */
  price_per_unit?: number | null;
  // Факт приёмки (правка 4.1.3): что фактически поступило (пересорт/расхождение с планом)
  fact_name: string | null;
  fact_color: string | null;
  fact_article: string | null;
  accept_status: MaterialAcceptStatus | null;
  accepted_at: string | null;
  accepted_by: string | null;
  accept_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Варианты поставщиков (правка 10) — приходят вложенным select вместе с материалом */
  suppliers?: ErpMaterialSupplier[];
}

/**
 * Вариант поставщика на позицию закупки (правка 10). Вариантов может быть несколько,
 * выбранный (`is_selected`) дублируется в erp_materials.supplier — так он виден везде,
 * где поставщик уже показывался, без правок тех экранов.
 */
export interface ErpMaterialSupplier {
  id: string;
  material_id: string;
  supplier: string;
  /** Цена за единицу закупки */
  price: number | null;
  /** Наличие — свободный текст: «200 кг на складе», «под заказ» */
  availability: string | null;
  /** Срок поставки, дней */
  lead_days: number | null;
  /** Минимальная партия — свободный текст: «от 50 кг» */
  min_batch: string | null;
  note: string | null;
  is_selected: boolean;
  created_at: string;
  updated_at: string;
}

/** Подписи колонок сравнения вариантов поставщика */
export const SUPPLIER_OPTION_LABELS = {
  supplier: 'Поставщик',
  price: 'Цена',
  availability: 'Наличие',
  lead_days: 'Срок, дн',
  min_batch: 'Мин. партия',
  note: 'Примечание',
} as const;

// --- Технические задания в PDF (волна 4) ------------------------------------

/**
 * Документ ТЗ. «Личность» документа — `group_id`, версии живут внутри группы:
 * замена файла добавляет строку version+1 и снимает `is_current` с прежней.
 * Назначения ссылаются на `group_id`, поэтому все связанные цеха автоматически
 * читают актуальную версию.
 *
 * `item_id === null` — общее ТЗ заказа: годится любой позиции.
 */
export interface ErpTzDocument {
  id: string;
  order_id: string;
  item_id: string | null;
  group_id: string;
  version: number;
  is_current: boolean;
  file_path: string;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/**
 * @deprecated 2026-08-03. Поцеховое назначение ТЗ отменено: документ принадлежит
 * позиции и виден всему её производственному маршруту (`itemTzDocument`).
 * Таблица `erp_tz_assignments` осталась в схеме пустой — код её не читает и не пишет.
 */
export interface ErpTzAssignment {
  id: string;
  order_id: string;
  item_id: string;
  department_id: string;
  group_id: string;
  assigned_by: string | null;
  created_at: string;
}

/** Бакет и префикс ТЗ в Supabase Storage */
export const TZ_BUCKET = 'erp-attachments';
export const TZ_PREFIX = 'tz';
/** Ограничения загрузки ТЗ: только PDF, до 15 МБ */
export const TZ_MIME = 'application/pdf';
export const TZ_MAX_BYTES = 15 * 1024 * 1024;

/** Складская операция (правка 2): строка истории сопровождения заказа складом */
export interface ErpWarehouseOp {
  id: string;
  order_id: string;
  material_id: string | null;
  op_type: WarehouseOpType;
  qty: number | null;
  note: string | null;
  actor: string | null;
  created_at: string;
}

/** Задача склада (волна 4): приёмка материалов / выпуск маркировки / упаковка и отгрузка */
export interface ErpWarehouseTask {
  id: string;
  order_id: string;
  item_id: string | null;
  task_type: WarehouseTaskType;
  status: WarehouseTaskStatus;
  marking_type: string | null;
  deadline: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// --- Задачи закупки (возврат из закроя → дозакупка/замена) -------------------

export type ProcurementCauseType =
  | 'supplier_defect'         // брак поставщика
  | 'wrong_consumption'       // неверно рассчитанный расход
  | 'damaged_in_production'   // материал испорчен на производстве
  | 'shortage'                // нехватка материала
  | 'other';                  // прочая причина

/** replacement = возврат/замена (брак поставщика); restock = дозакупка (внутренняя ошибка) */
export type ProcurementTaskKind = 'replacement' | 'restock';

export type ProcurementTaskStatus =
  | 'new' | 'in_progress' | 'ordered' | 'done' | 'cancelled';

export interface ErpProcurementTask {
  id: string;
  order_id: string;
  item_id: string | null;
  source_stage_id: string | null;
  initiating_dept: string | null;
  material_name: string;
  rework_qty: number | null;
  required_qty: string | null;
  cause_type: ProcurementCauseType;
  kind: ProcurementTaskKind;
  reason: string | null;
  supplier: string | null;
  planned_date: string | null;
  responsible: string | null;
  status: ProcurementTaskStatus;
  counts_as_purchase: boolean;
  created_at: string;
  updated_at: string;
}

// --- Подряд (операции, переданные внешним подрядчикам) -----------------------

export type SubcontractStatus =
  // отдельная операция
  | 'planned' | 'sent' | 'in_progress' | 'returned' | 'delayed' | 'cancelled'
  // готовое изделие от подрядчика (волна 4.2)
  | 'awaiting_payment' | 'awaiting_materials' | 'started'
  | 'ready_to_ship' | 'shipped_by_contractor' | 'received_at_pinhead';

/** Жизненный цикл статусов «готового изделия» от подрядчика (для стейт-машины) */
export const SUBCONTRACT_FINISHED_FLOW: SubcontractStatus[] = [
  'awaiting_payment', 'awaiting_materials', 'started',
  'ready_to_ship', 'shipped_by_contractor', 'received_at_pinhead',
];

/** Тип операции подряда: готовое изделие целиком или отдельная тех. операция */
export type SubcontractOpType = 'finished_product' | 'operation';
/** Кто предоставляет материалы: Pinhead (проходит закупку) или подрядчик (не проходит) */
export type SubcontractMaterialSource = 'pinhead' | 'contractor';

export interface ErpSubcontractOp {
  id: string;
  order_id: string;
  item_id: string | null;
  operation: string;
  op_type: SubcontractOpType;
  material_source: SubcontractMaterialSource;
  /** Цех возврата после «отдельной операции» (null для готового изделия) */
  return_dept: string | null;
  contractor: string | null;
  qty: number | null;
  sent_date: string | null;
  planned_date: string | null;
  returned_date: string | null;
  status: SubcontractStatus;
  /**
   * Этап маршрута, которым этот подряд является (волна 3.5). NULL — подряд
   * «под ключ»: у него этапа нет вовсе, `buildItemRoute` вырезает даже закупку
   * при материалах подрядчика. Одна таблица, две роли.
   */
  stage_id?: string | null;
  /** Фаза внутри этапа. Единый статус — у этапа, см. SubcontractPhase */
  phase?: SubcontractPhase;
  /** Оплата: в производственных переходах НЕ участвует */
  payment_status?: SubcontractPaymentStatus;
  paid_amount?: number | null;
  /** Суммы журнала перемещений — их ведёт триггер, клиент только читает */
  qty_sent?: number;
  qty_returned?: number;
  qty_accepted?: number;
  delay_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Присоединяется при загрузке (заголовок/№ заказа для таблицы) */
  order?: { title: string; bitrix_id: string | null } | null;
}

// --- Экспериментальный цех (правка 6) --------------------------------------

export type ExperimentalPhase =
  | 'patterns' | 'development' | 'final_fitting' | 'returned_to_constructor' | 'done';
export type ExperimentalOutcome =
  | 'approved' | 'needs_rework' | 'needs_rebranding' | 'needs_pattern_change' | 'ready_for_serial';
export type ExperimentalOpKind = 'to_sewing' | 'to_branding';
export type ExperimentalOpStatus = 'sent' | 'in_progress' | 'returned' | 'cancelled';

export interface ErpExperimentalOp {
  id: string;
  experimental_id: string;
  kind: ExperimentalOpKind;
  operation: string | null;
  qty: number | null;
  responsible: string | null;
  planned_date: string | null;
  comment: string | null;
  status: ExperimentalOpStatus;
  /**
   * Этап, которым эта передача СТАЛА (волна 3.6). Задача нанесения образца —
   * одна строка `erp_item_stages`, её видит очередь цеха: двух независимых
   * задач нет физически, а не по соглашению.
   */
  stage_id?: string | null;
  returned_at: string | null;
  branding_method: string | null;
  mockup: string | null;
  zone: string | null;
  size_mm: string | null;
  colors: string | null;
  created_at: string;
}

export interface ErpExperimental {
  id: string;
  order_id: string;
  phase: ExperimentalPhase;
  tech_name: string | null;
  measurement_table: string | null;
  has_3d: boolean;
  constructor: string | null;
  technologist: string | null;
  final_outcome: ExperimentalOutcome | null;
  constructor_return_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Присоединяются при загрузке */
  ops?: ErpExperimentalOp[];
  order?: { title: string; bitrix_id: string | null } | null;
}

/**
 * Задача производственного плана: этап × день (таблица `erp_calendar_slots`).
 * Руководитель производства раскладывает этапы по цехам и дням вручную, цех
 * ежедневно вносит факт. Система план не составляет — только показывает отклонения.
 */
export interface ErpCalendarSlot {
  id: string;
  department_id: string;
  stage_id: string | null;
  work_date: string;
  qty_planned: number;
  qty_done: number | null;
  assignee: string | null;
  status: SlotStatus;
  /** Комментарий руководителя производства при постановке задачи */
  comment: string | null;
  created_at: string;
  updated_at: string;
  /** Брак, зафиксированный цехом в этот день */
  qty_defect: number;
  /** Комментарий ответственного за цех при внесении факта */
  fact_comment: string | null;
  /** Почему сделали меньше плана — обязателен при недовыполнении */
  deviation_reason: string | null;
  fact_by: string | null;
  fact_at: string | null;
  created_by: string | null;
  /** Очерёдность внутри дня (numeric-середина, как queue_position) */
  sort_order: number;
  priority: number;
  /** Проблема по задаче дня. Блокировка самого этапа — в erp_item_stages.status */
  problem_type: string | null;
  problem_note: string | null;
  problem_affects_due: boolean;
  problem_needs_help: boolean;
  problem_can_continue: boolean;
}

/** Сообщение в переписке по задаче плана */
export interface ErpPlanComment {
  id: string;
  slot_id: string;
  author: string;
  /** Кто пишет: постановщик или цех — на карточке это разные значки */
  side: 'manager' | 'shop';
  text: string;
  created_at: string;
}

// --- Подписи для UI (язык интерфейса — русский) ------------------------------

export const PRODUCTION_TYPE_LABELS: Record<ProductionType, string> = {
  no_product: 'Без изделий',
  ready_garment: 'Готовое изделие',
  cut: 'Крой',
  sewing: 'Пошив',
  samples: 'Образцы',
  outsource: 'Подряд',
};

export const BRANDING_METHOD_LABELS: Record<BrandingMethod, string> = {
  embroidery: 'Вышивка',
  silkscreen: 'Шелкография',
  dtf: 'ДТФ',
  heat_transfer: 'Термоперенос',
  other: 'Прочие',
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  waiting: 'Ожидает',
  ready: 'Готов к работе',
  in_progress: 'В работе',
  done: 'Готово',
  skipped: 'Пропущен',
  blocked: 'Заблокирован',
};

/** Виды материалов — для настройки материального гейта участка в админке */
export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  fabric: 'ткань',
  hardware: 'фурнитура',
  labels: 'бирки',
  packaging: 'упаковка',
  other: 'прочее',
};

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  pending: 'Не заказано',
  ordered: 'Заказано',
  in_transit: 'В пути',
  received: 'Пришло',
  partial: 'Частично',
  not_needed: 'Не требуется',
  reserved: 'Доступен со склада',
};

export const MATERIAL_ACCEPT_LABELS: Record<MaterialAcceptStatus, string> = {
  accepted_full: 'Принято полностью',
  accepted_partial: 'Принято частично',
  shortage: 'Недостача',
  mismatch: 'Пересорт',
  rejected: 'Не принято',
};

export const WAREHOUSE_OP_LABELS: Record<WarehouseOpType, string> = {
  material_receipt: 'Приёмка материалов',
  rework_receipt: 'Приёмка после дозакупки',
  partial_receipt: 'Частичная приёмка',
  packaging: 'Упаковка',
  shipment: 'Отгрузка',
  marking: 'Выпуск маркировки',
};

export const WAREHOUSE_TASK_TYPE_LABELS: Record<WarehouseTaskType, string> = {
  material_receipt: 'Приёмка материалов',
  marking: 'Выпуск маркировки',
  fg_receipt: 'Приёмка готовой продукции',
  pack_ship: 'Упаковка и отгрузка',
  subcontract_receipt: 'Приёмка продукции от подрядчика',
};

/** Статусы приёмки готовой продукции с производства (волна 3.4) */
export const FG_RECEIPT_STATUS_LABELS: Record<FgReceiptStatus, string> = {
  awaiting: 'Ожидает приёмки',
  accepted: 'Принято на склад',
};

export const SUBCONTRACT_RECEIPT_STATUS_LABELS: Record<SubcontractReceiptStatus, string> = {
  awaiting_receipt: 'Ожидает приёмки',
  accepted: 'Продукция принята',
};

export const MARKING_STATUS_LABELS: Record<MarkingStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  issued: 'Маркировка выпущена',
};

export const PACK_SHIP_STATUS_LABELS: Record<PackShipStatus, string> = {
  awaiting_receipt: 'Ожидает приёмки',
  accepted: 'Принято',
  packing: 'На упаковке',
  packed: 'Упаковано',
  ready_to_ship: 'Готово к отгрузке',
  shipped: 'Отгружено',
};

export const PROCUREMENT_CAUSE_LABELS: Record<ProcurementCauseType, string> = {
  supplier_defect: 'Брак поставщика',
  wrong_consumption: 'Неверно рассчитанный расход',
  damaged_in_production: 'Материал испорчен на производстве',
  shortage: 'Нехватка материала',
  other: 'Прочая причина',
};

export const PROCUREMENT_STATUS_LABELS: Record<ProcurementTaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  ordered: 'Заказано',
  done: 'Выполнено',
  cancelled: 'Отменена',
};

export const PROCUREMENT_KIND_LABELS: Record<ProcurementTaskKind, string> = {
  replacement: 'Возврат/замена',
  restock: 'Дозакупка',
};

export const SUBCONTRACT_STATUS_LABELS: Record<SubcontractStatus, string> = {
  planned: 'Запланировано',
  sent: 'Передано',
  in_progress: 'В работе',
  returned: 'Возвращено',
  delayed: 'Задержка',
  cancelled: 'Отменено',
  // готовое изделие от подрядчика (волна 4.2)
  awaiting_payment: 'Ожидает оплаты',
  awaiting_materials: 'Ожидает материалов',
  started: 'Начал работу',
  ready_to_ship: 'Готово к отгрузке',
  shipped_by_contractor: 'Отгружено подрядчиком',
  received_at_pinhead: 'Поступило на производство',
};

/**
 * Фаза подряда (волна 3.5) — детализация ВНУТРИ `in_progress` этапа, а не
 * второй статус. Единый статус — `erp_item_stages.status`: его читают канбан,
 * очередь, план и гейты, и вторая машина состояний рядом с ними была ровно
 * тем, из-за чего подряд жил отдельной жизнью.
 */
export type SubcontractPhase =
  | 'planned' | 'materials_ready' | 'sent' | 'at_contractor'
  | 'returned' | 'accepted' | 'closed';

export const SUBCONTRACT_PHASE_LABELS: Record<SubcontractPhase, string> = {
  planned: 'Запланировано',
  materials_ready: 'Материалы собраны',
  sent: 'Передано подрядчику',
  at_contractor: 'У подрядчика',
  returned: 'Вернулось',
  accepted: 'Принято складом',
  closed: 'Закрыто',
};

/**
 * Оплата подряда. Финансовый признак НЕ участвует ни в одном производственном
 * переходе: неоплаченный подряд не должен останавливать цех — прямое требование
 * документа («оплата не должна быть первым производственным этапом»).
 */
export type SubcontractPaymentStatus = 'unpaid' | 'prepaid' | 'paid';

export const SUBCONTRACT_PAYMENT_LABELS: Record<SubcontractPaymentStatus, string> = {
  unpaid: 'Не оплачено',
  prepaid: 'Аванс',
  paid: 'Оплачено',
};

/** Перемещение по подряду: передали / вернулось / приняли */
export type SubcontractMoveKind = 'send' | 'return' | 'accept';

export const SUBCONTRACT_MOVE_LABELS: Record<SubcontractMoveKind, string> = {
  send: 'Передано подрядчику',
  return: 'Вернулось от подрядчика',
  accept: 'Принято складом',
};

export interface ErpSubcontractMove {
  id: string;
  subcontract_id: string;
  kind: SubcontractMoveKind;
  qty: number;
  moved_on: string;
  comment: string | null;
  author: string | null;
  author_id: string | null;
  created_at: string;
}

export const SUBCONTRACT_OP_TYPE_LABELS: Record<SubcontractOpType, string> = {
  finished_product: 'Готовое изделие',
  operation: 'Отдельная операция',
};

export const SUBCONTRACT_MATERIAL_SOURCE_LABELS: Record<SubcontractMaterialSource, string> = {
  pinhead: 'Материалы Pinhead',
  contractor: 'Материалы подрядчика',
};

export const EXPERIMENTAL_PHASE_LABELS: Record<ExperimentalPhase, string> = {
  patterns: 'Построение лекал',
  development: 'Проработка',
  final_fitting: 'Финальная примерка',
  returned_to_constructor: 'Возврат конструктору',
  done: 'Готов к серии',
};

export const EXPERIMENTAL_OUTCOME_LABELS: Record<ExperimentalOutcome, string> = {
  approved: 'Образец утверждён',
  needs_rework: 'Нужна доработка',
  needs_rebranding: 'Повторное нанесение',
  needs_pattern_change: 'Изменение лекал',
  ready_for_serial: 'Готов к серийному производству',
};

export const EXPERIMENTAL_OP_KIND_LABELS: Record<ExperimentalOpKind, string> = {
  to_sewing: 'В общий швейный цех',
  to_branding: 'На нанесение',
};

export const EXPERIMENTAL_OP_STATUS_LABELS: Record<ExperimentalOpStatus, string> = {
  sent: 'Передано',
  in_progress: 'В работе',
  returned: 'Возвращено',
  cancelled: 'Отменено',
};

export const ORDER_STATUS_LABELS: Record<ErpOrderStatus, string> = {
  active: 'В работе',
  done_on_time: 'Сдан вовремя',
  done_late: 'Сдан с опозданием',
  done_early: 'Сдан заранее',
  cancelled: 'Отменён',
};

export const SHIPPED_STATUS_LABELS: Record<ErpShippedStatus, string> = {
  not_shipped: 'Не отгружено',
  partial: 'Отгружено частично',
  shipped: 'Отгружено',
};

// --- Сотрудники и аудит (блок улучшений) -------------------------------------

/**
 * Цеховая роль сотрудника.
 *
 * Коды НЕ переименовываются под новые названия из документа заказчика (10.08):
 * код роли зашит в CHECK-констрейнт, в матрицу `erp_role_permissions`, в серверное
 * зеркало `erp_role_of_caller()` и в сторожевые тесты. Меняются подписи
 * (`EMPLOYEE_ROLE_LABELS`) — их и видит человек.
 */
export type EmployeeRole =
  | 'worker' | 'foreman' | 'dispatcher' | 'purchaser'
  | 'storekeeper' | 'hr' | 'manager' | 'director'
  /** Ведёт недельный и ежедневный план производства (правка менеджера 2026-08-03) */
  | 'production_head'
  /** Отвечает за экспериментальный цех и разработку образцов (правки 10.08) */
  | 'technologist'
  /**
   * Роли участков нанесения (правки 10.08). По правам они не различаются между
   * собой — различает их привязка `erp_employees.department_id`. Заведены отдельно,
   * потому что заказчик перечислил их как самостоятельные роли команды.
   */
  | 'dtf' | 'silkscreen' | 'embroidery';

export interface ErpEmployee {
  id: string;
  full_name: string;
  role: EmployeeRole;
  department_id: string | null;
  extra_department_ids: string[];
  profile_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ErpStageEvent {
  id: string;
  stage_id: string;
  order_id: string;
  actor: string | null;
  from_status: string | null;
  to_status: string;
  qty_done: number | null;
  qty_rework: number | null;
  comment: string | null;
  created_at: string;
}

/**
 * Подписи ролей — по фактической структуре команды (документ заказчика 10.08).
 * Мастер цеха отвечает сразу за закрой и швейку, менеджер сопровождения ведёт
 * заказ и связывает производство с заказчиком.
 */
export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  worker: 'Сотрудник цеха',
  foreman: 'Мастер цеха',
  dispatcher: 'Диспетчер',
  purchaser: 'Закупщик',
  storekeeper: 'Кладовщик',
  hr: 'HR',
  manager: 'МС — менеджер сопровождения',
  director: 'Директор',
  production_head: 'Руководитель производства',
  technologist: 'Технолог',
  dtf: 'ДТФ',
  silkscreen: 'Шелкография',
  embroidery: 'Вышивка',
};

// --- Матрица прав (ядро правки 11) ------------------------------------------

/**
 * Что роль вправе делать. Ограничение «только свой цех» — отдельная проверка
 * по привязке erp_employees.department_id, матрицей не отменяется.
 */
export type ErpPermission =
  | 'stage.take'              // взять задание в работу (закрепить за собой)
  | 'stage.progress'          // записать фактически выполненное количество
  | 'stage.complete'          // завершить этап
  | 'stage.block'             // сообщить о проблеме / снять блокировку
  | 'stage.defect'            // оформить брак / переделку
  | 'stage.priority'          // менять приоритет заданий в очереди
  | 'stage.move_department'   // переносить задание между цехами на канбане
  | 'order.manage'            // создавать и редактировать заказы
  | 'tz.manage'               // загружать и заменять ТЗ позиции
  | 'material.receive'        // отмечать поступление материала (приёмка)
  | 'plan.manage'             // ставить и менять производственный план
  | 'plan.fact'               // вносить факт, брак и проблему по задаче плана
  | 'catalog.edit'            // редактировать справочники
  | 'bypass.manage'           // аварийно снимать блокировки и возвращать их
  | 'experimental.manage';   // вести разработку образцов и отправлять их в цеха

export const ERP_PERMISSIONS: ErpPermission[] = [
  'stage.take', 'stage.progress', 'stage.complete', 'stage.block', 'stage.defect',
  'stage.priority', 'stage.move_department', 'order.manage', 'tz.manage',
  'material.receive', 'plan.manage', 'plan.fact', 'catalog.edit', 'bypass.manage',
  'experimental.manage',
];

export const ERP_PERMISSION_LABELS: Record<ErpPermission, string> = {
  'stage.take': 'Брать задания в работу',
  'stage.progress': 'Записывать результат',
  'stage.complete': 'Завершать этап',
  'stage.block': 'Сообщать о проблеме',
  'stage.defect': 'Оформлять брак',
  'stage.priority': 'Менять приоритеты',
  'stage.move_department': 'Переносить между цехами',
  'order.manage': 'Создавать и править заказы',
  'tz.manage': 'Вести ТЗ (загрузка и замена)',
  'material.receive': 'Отмечать поступление материалов',
  'plan.manage': 'Вести производственный план',
  'plan.fact': 'Вносить факт по плану',
  'catalog.edit': 'Править справочники',
  'experimental.manage': 'Вести экспериментальный цех',
  'bypass.manage': 'Аварийно снимать блокировки',
};

// --- Аварийное снятие блокировок (правки заказчика 10.08) --------------------

/**
 * Что именно снято. Зависимости этапов сюда не входят: «этап ждёт предыдущий» —
 * это маршрут, а не проверка; для застрявшего маршрута есть пропуск этапа.
 */
export type BypassKind = 'material_gate' | 'tz_gate' | 'ship_gate';

export const BYPASS_KINDS: BypassKind[] = ['material_gate', 'tz_gate', 'ship_gate'];

export const BYPASS_KIND_LABELS: Record<BypassKind, string> = {
  material_gate: 'Запуск без материалов',
  tz_gate: 'Запуск без ТЗ',
  ship_gate: 'Отгрузка без готовности',
};

/** Что человек увидит рядом с галочкой — последствие, а не название механики */
export const BYPASS_KIND_HINTS: Record<BypassKind, string> = {
  material_gate: 'Цех сможет взять задание, пока склад не принял материал',
  tz_gate: 'Этап запустится, даже если у позиции нет ТЗ',
  ship_gate: 'Заказ можно будет отгрузить с незакрытыми этапами',
};

export interface ErpBypass {
  id: string;
  kind: BypassKind;
  /** null — снято для всей системы; иначе только для этого заказа */
  order_id: string | null;
  reason: string;
  created_by: string | null;
  created_by_id: string | null;
  created_at: string;
  restored_by: string | null;
  restored_by_id: string | null;
  /** null — снятие действует */
  restored_at: string | null;
}

/** Строка матрицы прав (таблица erp_role_permissions) */
export interface ErpRolePermission {
  role: EmployeeRole;
  permission: ErpPermission;
  allowed: boolean;
  updated_at: string;
}

// --- Справочники админки (правка 12) ----------------------------------------

/**
 * Виды редактируемых справочников. Статусы (этапов, заказов, материалов, склада,
 * подряда) сюда не входят: они зашиты в CHECK-констрейнты и стейт-машины —
 * в админке показаны только для чтения.
 */
export type DictionaryKind =
  'block_reason' | 'problem_type' | 'product_type' | 'supplier' | 'unit';

export const DICTIONARY_LABELS: Record<DictionaryKind, string> = {
  block_reason: 'Причины блокировок',
  problem_type: 'Типы проблем',
  product_type: 'Типы изделий',
  supplier: 'Поставщики',
  unit: 'Единицы измерения',
};

/** Подсказка под заголовком справочника — где значение всплывает в работе */
export const DICTIONARY_HINTS: Record<DictionaryKind, string> = {
  block_reason: 'Быстрый выбор в форме «Проблема» у задания цеха.',
  problem_type: 'Быстрый выбор при оформлении брака и переделки.',
  product_type: 'Подсказки в поле «Изделие» при создании заказа.',
  unit: 'Подсказки в поле единицы измерения материала (кг, м, шт).',
  supplier: 'Подсказки в поле «Поставщик» в закупке и материалах заказа.',
};

export interface ErpDictionaryItem {
  id: string;
  kind: DictionaryKind;
  code: string;
  name: string;
  sort_order: number;
  active: boolean;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// --- Поля ТЗ (docs/erp/tz-format-analysis.md) --------------------------------

export type PackagingType = 'none' | 'bopp' | 'zip' | 'other';
export type StickersType = 'none' | 'blank' | 'other';

export const PACKAGING_LABELS: Record<PackagingType, string> = {
  none: 'Нет',
  bopp: 'БОПП-пакет',
  zip: 'ZIP-пакет',
  other: 'Другое',
};

export const STICKERS_LABELS: Record<StickersType, string> = {
  none: 'Нет',
  blank: 'Бланк',
  other: 'Другое',
};

/** Размерная сетка позиции: цвет × размер → шт */
export interface SizeGridRow {
  color: string;
  sizes: Record<string, number>;
}

/** Нанесение с параметрами (страницы «Нанесение №N» ТЗ) */
export interface ErpItemPrint {
  id: string;
  item_id: string;
  seq: number;
  method: BrandingMethod;
  fabric: string | null;
  zone: string | null;
  width_mm: number | null;
  height_mm: number | null;
  offset_note: string | null;
  pantone: string | null;
  special: string | null;
  comment: string | null;
  created_at: string;
}

export type MaterialRole =
  | 'main' | 'trim' | 'lining' | 'hardware' | 'labels' | 'packaging' | 'other';

export const MATERIAL_ROLE_LABELS: Record<MaterialRole, string> = {
  main: 'Основное полотно',
  trim: 'Отделочное',
  lining: 'Подклад',
  hardware: 'Фурнитура',
  labels: 'Бирки/этикетки',
  packaging: 'Упаковка',
  other: 'Прочее',
};
