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
  | 'dtg'            // DTG — прямая печать по изделию (правки 20.08)
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
  | 'material_receipt' | 'marking' | 'fg_receipt' | 'pack_ship'
  /**
   * ПЕРЕДАЧА подрядчику (правка 24.08, п. 3: «каждый новый выход к подрядчику
   * должен проходить через складскую передачу… заказ не может получить статус
   * "У подрядчика", пока склад не зафиксировал фактическую передачу»).
   * Зеркальная половина приёмки: раньше была только вторая.
   */
  | 'subcontract_send'
  | 'subcontract_receipt';
/** Статусы задач склада по типам */
export type MaterialReceiptStatus = 'awaiting' | 'accepted';
export type SubcontractSendStatus = 'awaiting' | 'sent';
export type MarkingStatus = 'new' | 'in_progress' | 'issued';
/**
 * «Упаковка и отгрузка» — ТРИ статуса и два действия (правка 23.08, п. 4).
 *
 * Прежние `awaiting_receipt`/`accepted` были недостижимы: задача заводится
 * под условием `erp_can_pack_ship`, а та требует принятой приёмки ГП — то есть
 * задача рождается уже принятой, и кнопки под этими статусами повторяли
 * отдельную задачу «Приёмка ГП». `packed` и `ready_to_ship` означали одно
 * событие. Схлопнуто миграцией 20260823170000 вместе с обоими писателями.
 */
export type PackShipStatus = 'packing' | 'ready_to_ship' | 'shipped';
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
   * Требуется ли закупка (правки заказчика 20.08). `false` — менеджер ЯВНО
   * отметил «Закупка не требуется»: этап `supply` в маршрут не заводится,
   * и заказ не появляется у закупщика. Хранится, а не выводится из пустого
   * списка материалов: «закупать нечего» и «до закупки ещё не дошли» —
   * разные состояния, и второе не должно молча закрывать заказу путь.
   */
  purchase_required?: boolean;
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
  /**
   * Технический блок изделия (правки заказчика 16.08). Свободные поля: цех
   * читает их в задании, они же уходят в ТЗ. Порядок заполнения позиции по
   * документу: Изделие → Цвет → Крой → Размер → Количество.
   */
  fit?: string | null;
  /**
   * Основное полотно (правка 22.08, п. 5.1). Отдельно от `trim_material`:
   * у изделия бывает и основная ткань, и отделочная, а одно поле на двоих
   * означает, что цех прочитает половину.
   */
  main_fabric?: string | null;
  trim_material?: string | null;
  cutting_note?: string | null;
  sewing_note?: string | null;
  labels_note?: string | null;
  /**
   * Упаковка ПОЗИЦИИ. `inherit` (значение по умолчанию) = брать из заказа;
   * резолюция — `utils/packaging.itemPackaging`, второго места с этим правилом
   * быть не должно. У позиций, заведённых до правки, колонки нет вовсе —
   * это тоже читается как «как в заказе».
   */
  packaging?: ItemPackagingType | null;
  packaging_note?: string | null;
  created_at: string;
  updated_at: string;
}

/** Упаковка позиции: та же шкала, что у заказа, плюс «как в заказе» */
export type ItemPackagingType = 'inherit' | PackagingType;

/** Кто выполняет этап маршрута (правки заказчика 16.08) */
export type StageExecutor = 'internal' | 'contractor';

export interface ErpItemStage {
  id: string;
  item_id: string;
  department_id: string;
  /**
   * Исполнитель этапа. `contractor` — работу делает подрядчик: этап НЕ попадает
   * в очередь нашего цеха и в его загрузку, а ведётся в разделе «Подряд».
   *
   * `department_id` при этом остаётся и означает ЧЕЙ ЭТО УЧАСТОК
   * ОТВЕТСТВЕННОСТИ — какой наш цех делал бы эту работу и куда она вернётся.
   * Псевдо-цех «Подряд» завести было нельзя: он потёк бы во все поверхности,
   * читающие цеха из данных, а уникальность (item_id, department_id, cycle)
   * разрешила бы ровно один подрядный этап на позицию.
   *
   * Поле НЕОБЯЗАТЕЛЬНО в типе: у этапов, приехавших урезанным запросом или
   * из старых фикстур, его нет, и правило обязано быть fail-open к `undefined` —
   * сравнивать надо с `'contractor'`, а не с `!== 'internal'`.
   */
  executor?: StageExecutor;
  /** Подрядчик свободным текстом — справочника на первом этапе не заводим */
  contractor?: string | null;
  /** Имя операции, когда оно расходится с именем цеха-владельца */
  operation?: string | null;
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
  /**
   * Лист закупки (правки заказчика 16.08). Документ требует разделить поля
   * менеджера и закупщика: «один показатель не должен заменять другой».
   *
   * `manager_note` — комментарий МЕНЕДЖЕРА при создании заказа, отдельно от
   * `notes` закупщика. Раньше поле было одно, и обе роли писали в одну строку.
   *
   * `qty_ordered` — сколько закупщик фактически ЗАКАЗАЛ. Это ни план
   * (`qty_expected`), ни приход (`qty_received`): «нужно было 100 м →
   * закупили 110 м» — про разницу первого и этого.
   */
  manager_note?: string | null;
  qty_ordered?: number | null;
  ordered_on?: string | null;
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
  /**
   * Этап маршрута, к которому относится задача — заполнен у приёмки подряда
   * (правки 20.08). У заказа подрядных этапов может быть несколько, и задача
   * «одна на заказ» означала бы, что вторую приёмку склад не увидит вовсе.
   * NULL — задача по заказу целиком (материалы, маркировка, упаковка).
   */
  stage_id?: string | null;
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

/**
 * @deprecated Операцию подряда двигает `SubcontractPhase`, а не этот статус.
 *
 * Колонка `erp_subcontracting.status` осталась в схеме (`not null`) и пишется
 * ЗЕРКАЛОМ из фазы — `utils/subcontractPhase.legacyStatusFromPhase`. Читать её
 * не нужно нигде: значения вроде `awaiting_payment` волна 3.5 убрала из
 * производственного потока, а `ready_to_ship`/`shipped_by_contractor` больше
 * не выставляются как самостоятельные шаги. Тип держится ради типизации
 * зеркала и снимется вместе с колонкой отдельной миграцией.
 */
export type SubcontractStatus =
  // отдельная операция
  | 'planned' | 'sent' | 'in_progress' | 'returned' | 'delayed' | 'cancelled'
  // готовое изделие от подрядчика (волна 4.2)
  | 'awaiting_payment' | 'awaiting_materials' | 'started'
  | 'ready_to_ship' | 'shipped_by_contractor' | 'received_at_pinhead';

/** Тип операции подряда: готовое изделие целиком или отдельная тех. операция */
export type SubcontractOpType = 'finished_product' | 'operation';
/**
 * Кто предоставляет материалы: Pinhead (проходит закупку), подрядчик
 * (не проходит) или смешанно — документ прямо называет третий вариант
 * («часть материалов наша, часть подрядчика»). `mixed` ведёт себя как
 * `pinhead`: раз хоть что-то наше, закупка и передача материалов нужны.
 */
export type SubcontractMaterialSource = 'pinhead' | 'contractor' | 'mixed';

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
  /**
   * Брак, отмеченный ЯВНО (правка 22.08, п. 3.9). Тоже сумма журнала —
   * писателя у неё ровно один, триггер `erp_subcontract_moves_rollup`.
   */
  qty_defect?: number;
  /**
   * Сколько единиц подрядчик должен произвести (правка 22.08, п. 3.8).
   *
   * ОТДЕЛЬНО ОТ `qty_sent`, и это главное в правке: подрядчик, печатающий
   * 200 штук на СВОЁМ материале, не получает от нас ничего — «передано 0,
   * в работе 200» это нормальное состояние, а не недостача. Величина
   * не приращается журналом: это решение менеджера при запуске работы.
   */
  qty_in_work?: number | null;
  /**
   * Поля подрядного этапа из документа 20.08. Заполняются В МАРШРУТЕ, одним
   * движением с выбором исполнителя «Подрядчик»: разносить их по двум экранам
   * значит гарантировать, что половина останется пустой.
   *
   * `send_plan_date` — план ПЕРЕДАЧИ; `planned_date` в этой таблице означает
   * возврат, и второго смысла ей не дают. `materials_note` — «что передаём»
   * (поле было и значит ровно это). `comment` — свободный комментарий,
   * отдельно от `delay_comment`: тот про задержку.
   */
  send_plan_date?: string | null;
  responsible?: string | null;
  comment?: string | null;
  delay_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Присоединяется при загрузке (заголовок/№ заказа для таблицы) */
  order?: { title: string; bitrix_id: string | null } | null;
  /**
   * Журнал перемещений, присоединяется при загрузке. Именно он, а не правка
   * количеств руками, двигает `qty_sent`/`qty_returned`/`qty_accepted`:
   * их ведёт триггер `erp_subcontract_moves_rollup`, а приёмка вдобавок
   * приращает `qty_done` привязанного этапа — тем же серверным правилом,
   * что и все остальные счётчики производства.
   */
  moves?: ErpSubcontractMove[];
}

// --- Экспериментальный цех (правка 6) --------------------------------------

/**
 * Разработка изделия в экспериментальном цехе.
 *
 * Фазовая модель (`ExperimentalPhase`, `ExperimentalOutcome`, `ErpExperimentalOp`)
 * удалена вместе с колонками 12.08: разработка не линейна, работа ведётся
 * набором задач, а состояние ВЫЧИСЛЯЕТСЯ (`utils/experimentalTasks.devState`).
 * Хранится только исход.
 */

/**
 * Статус задачи разработки — ровно пять из документа (п.12) плюс отмена.
 *
 * `waiting` — задача передана в цех и её ведёт триггер: клиент такую строку
 * только читает, иначе у колонки два писателя.
 */
export type DevTaskStatus =
  'todo' | 'in_progress' | 'waiting' | 'blocked' | 'done' | 'cancelled';

export const DEV_TASK_STATUS_LABELS: Record<DevTaskStatus, string> = {
  todo: 'Не начато',
  in_progress: 'В работе',
  waiting: 'Ожидает',
  blocked: 'Заблокировано',
  done: 'Готово',
  cancelled: 'Отменено',
};

/**
 * Исход разработки (ТЗ п.9). Это ФИНАЛЬНЫЙ СТАТУС, а не очередной этап
 * маршрута: «Готово к серии» ничего не создаёт автоматически — производственный
 * заказ заводит менеджер (решение заказчика).
 */
export type DevOutcome =
  'ready_for_serial' | 'needs_rework' | 'moved_to_production' | 'cancelled' | 'other';

export const DEV_OUTCOME_LABELS: Record<DevOutcome, string> = {
  ready_for_serial: 'Готово к серии',
  needs_rework: 'Нужна доработка',
  moved_to_production: 'Передано в основной цех',
  cancelled: 'Отменено',
  other: 'Другое',
};

export interface ErpExperimentalTask {
  id: string;
  experimental_id: string;
  /** Код из справочника `experimental_task_type`; ввод свободный */
  task_type: string;
  title: string | null;
  responsible: string | null;
  due_date: string | null;
  status: DevTaskStatus;
  blocked_reason: string | null;
  /** Зависимости на задачи ТОЙ ЖЕ разработки */
  depends_on: string[];
  /** Номер круга: повторная примерка — новая строка, а не счётчик на старой */
  cycle: number;
  sort_order: number;
  qty: number | null;
  comment: string | null;
  result: string | null;
  /** Заполнены, только когда задача передана в цех */
  department_id: string | null;
  stage_id: string | null;
  done_on: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Вид вложения. `preview` — макет заказа, `attachment` — прочий файл; три
 * последних заведены правкой заказчика 16.08 и отвечают на вопрос «в каком
 * блоке карточки показывать»: без них файлы упаковки, техблока и листа закупки
 * свалились бы во вкладку «Файлы» вперемешку.
 */
export type ErpAttachmentKind =
  | 'preview' | 'attachment' | 'packaging' | 'tech' | 'purchase'
  /** Лист закупки, приложенный менеджером при создании заказа (правки 20.08) */
  | 'purchase_list'
  /**
   * Файлы ПОДРЯДНОГО ЭТАПА (правки 20.08): их отдают подрядчику. Не `tech`
   * у позиции — адресат другой, и подрядных этапов у позиции бывает несколько;
   * привязка идёт через `stage_id`.
   */
  | 'subcontract'
  /**
   * Файл ЗАДАЧИ разработки (правка 24.08, п. 4.4: «название, комментарий,
   * ответственный, срок, статус и файл при необходимости»). Привязан к задаче
   * (`task_id`), а не к разработке целиком: задач у неё десяток, и «фото
   * пробного нанесения» относится к одной из них.
   */
  | 'dev_task'
  /**
   * Финальный технический пакет разработки (правки 20.08). Файлы привязаны
   * к РАЗРАБОТКЕ (`experimental_id`), а не к позиции: лекала и техпаспорт
   * описывают модель, а не тот заказ, из которого она вышла.
   */
  | 'dev_pattern' | 'dev_passport' | 'dev_photo'
  /**
   * Макет КОНКРЕТНОГО нанесения и файл КОНКРЕТНОЙ бирки (правка 22.08,
   * пп. 5.2–5.3). До неё макеты лежали общей кучей вида `tech` у позиции,
   * и при трёх-четырёх нанесениях цех сам угадывал, какой к какому относится.
   */
  | 'print' | 'label'
  /** Изображение заметки к заказу (правка 22.08, п. 5.8) */
  | 'note';

export interface ErpOrderAttachment {
  id: string;
  order_id: string;
  /** Позиция, к которой относится файл. NULL — файл всего заказа */
  item_id?: string | null;
  /**
   * Строка листа закупки, к которой относится файл (правки 16.08, п. 14).
   * NULL — файл заказа или позиции. Референсы закупщика («фото материала,
   * скрин позиции поставщика») относятся к КОНКРЕТНОЙ строке: свалить их
   * в общую кучу значит отдать десяток картинок без ответа, к чему они.
   */
  material_id?: string | null;
  /**
   * Разработка, к которой относится файл (правки 20.08): лекала, техпаспорт,
   * фото образца. NULL — обычное вложение заказа.
   */
  experimental_id?: string | null;
  /**
   * Задача разработки, к которой приложен файл (правка 24.08, п. 4.4).
   * Заполняется ВМЕСТЕ с `experimental_id`: по нему работают политики
   * и уборка файлов при удалении разработки.
   */
  task_id?: string | null;
  /**
   * Нанесение или бирка, которой принадлежит файл (правка 22.08, пп. 5.2–5.3).
   * Связь именно со строкой, а не «где-то у позиции»: по каждому нанесению
   * должно быть однозначно видно, какой макет использовать.
   */
  print_id?: string | null;
  label_id?: string | null;
  /** Заметка к заказу, которой принадлежит изображение (правка 22.08) */
  note_id?: string | null;
  file_path: string;
  file_name: string | null;
  kind: ErpAttachmentKind;
  uploaded_by: string | null;
  created_at: string;
}

/**
 * Карточка SKU разработки — то, что читается ТОЛЬКО вместе с разработкой
 * (колонка `final_package jsonb`). В колонки вынесено лишь то, что ищут
 * и показывают в списке: название и версия лекал, ценовая вилка.
 *
 * Обязательность полей проверяет `utils/finalPackage.missingFinalPackage`,
 * и ровно то же — серверный страж `erp_dev_package_guard`.
 */
export interface DevFinalPackage {
  description?: string | null;
  /** Крой / посадка */
  fit?: string | null;
  /** Размерный ряд */
  size_row?: string | null;
  features?: string | null;
  finishes?: string | null;
  limits?: string | null;
  /**
   * Комментарии и особенности производства — «при необходимости» (п. 4.5),
   * то есть поле есть, а обязательным не считается.
   */
  production_notes?: string | null;
  /**
   * Идёт ли модель в каталог SKU (переключатель финального этапа, п. 4.6).
   * От него зависит, обязательны ли поля карточки SKU ниже; читается
   * через `wantsSkuCard`, а не по месту.
   */
  add_to_sku?: boolean | null;
  /**
   * Ссылка на лекала. С правки 24.08 НЕ спрашивается и не проверяется («поле
   * „Файл лекал или ссылка" не нужно»), но остаётся в типе: на проде она
   * заполнена у двух разработок, и показ на чтение обязан работать.
   * @deprecated ввода больше нет
   */
  pattern_link?: string | null;
  /** Все утверждённые ткани, а не только ткань образца */
  fabrics?: string[] | null;
  /** Допустимые нанесения для SKU */
  branding?: string[] | null;
  /** Возможные модификации: длина, карманы, молния, фурнитура… */
  modifications?: string[] | null;
}

export interface ErpExperimental {
  id: string;
  order_id: string;
  /**
   * Позиция заказа. Заменяет эвристику `items[0]`: передача задачи в цех
   * создаёт этап именно этой позиции, а не первой попавшейся.
   */
  item_id?: string | null;
  tech_name: string | null;
  measurement_table: string | null;
  has_3d: boolean;
  constructor: string | null;
  /** Проработчик. Код колонки не переименовывается — меняется только подпись */
  technologist: string | null;
  /**
   * Образец утверждён (правки 20.08). ЕДИНСТВЕННОЕ хранимое решение по этапам:
   * всё остальное — какой шаг идёт сейчас — вычисляется из задач
   * (`utils/experimentalBoard`). Из статусов это не вывести: закрытая примерка
   * одинаково означает и «принято», и «не принято», и разница жила
   * в свободном тексте `result`, то есть не читалась ничем.
   */
  sample_approved_at?: string | null;
  sample_approved_by?: string | null;
  sample_approved_note?: string | null;
  /**
   * Колонка канбана, поставленная технологом ВРУЧНУЮ (правка 24.08, п. 4.2:
   * «технолог сам вручную перетаскивает карточку… автоматическое движение
   * по основным этапам не нужно»). `null` — не двигали, и колонка считается
   * из задач по-прежнему. Значения — зеркало `DevStage` и CHECK
   * `erp_experimental_board_stage_check`; разрешает вопрос читателям
   * `utils/experimentalBoard.devBoardColumn`, а не каждый по месту.
   */
  board_stage?: string | null;
  /**
   * Финальный технический пакет (правки 20.08). В колонки вынесено то, что
   * ищут и показывают в списке; карточка SKU, ткани, нанесения и модификации
   * читаются только вместе с разработкой и живут в `final_package`.
   * Обязательность проверяют `utils/finalPackage` и страж `erp_dev_package_guard` —
   * вместе и одинаково.
   */
  pattern_tech_name?: string | null;
  pattern_version?: string | null;
  price_min?: number | null;
  price_max?: number | null;
  final_package?: DevFinalPackage | null;
  /**
   * Артикул каталога, в который перенесён финальный пакет (решение 21.08).
   * Пишет ТОЛЬКО `erp_sku_from_dev`; повторный перенос запрещён — иначе
   * у модели появилось бы два артикула, то есть два источника правды о ней.
   */
  sku_code?: string | null;
  /** Исход разработки; null — ещё идёт */
  outcome?: DevOutcome | null;
  outcome_comment?: string | null;
  closed_at?: string | null;
  owner?: string | null;
  dev_type?: string | null;
  priority?: number;
  due_date?: string | null;
  comment?: string | null;
  created_at: string;
  updated_at: string;
  /** Присоединяются при загрузке */
  tasks?: ErpExperimentalTask[];
  attachments?: ErpOrderAttachment[];
  order?: { title: string; bitrix_id: string | null; due_date?: string | null } | null;
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
  dtg: 'DTG',
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
  subcontract_send: 'Передача подрядчику',
  subcontract_receipt: 'Приёмка продукции от подрядчика',
};

/** Статусы приёмки готовой продукции с производства (волна 3.4) */
export const FG_RECEIPT_STATUS_LABELS: Record<FgReceiptStatus, string> = {
  awaiting: 'Ожидает приёмки',
  accepted: 'Принято на склад',
};

/**
 * Передача подрядчику: ждём отгрузки со склада — передано (п. 3).
 * Двух статусов достаточно: «сколько именно отдали» хранит журнал перемещений,
 * а не статус задачи.
 */
export const SUBCONTRACT_SEND_STATUS_LABELS: Record<SubcontractSendStatus, string> = {
  awaiting: 'Ожидает передачи',
  sent: 'Передано подрядчику',
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
  packing: 'На упаковке',
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

/** @deprecated Подписи устаревшего статуса — интерфейс показывает фазы (SUBCONTRACT_PHASE_LABELS) */
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
  | 'planned' | 'materials_ready' | 'sent' | 'at_contractor' | 'ready_at_contractor'
  | 'returned' | 'rework' | 'accepted' | 'closed';

/**
 * Подписи приведены к семи состояниям документа 20.08. Хранимых фаз больше
 * (девять), и это не расхождение: `sent` осталась от прежней модели и вручную
 * не выставляется, а `accepted`/`closed` различают «склад принял» и «операция
 * закрыта» — документ обе называет «Завершено», но складской гейт упаковки
 * читает именно их, и схлопывать значения нельзя.
 */
export const SUBCONTRACT_PHASE_LABELS: Record<SubcontractPhase, string> = {
  planned: 'Запланировано',
  materials_ready: 'Готово к передаче',
  sent: 'Передано подрядчику',
  at_contractor: 'У подрядчика',
  /**
   * Восьмое состояние документа. Отличается от «У подрядчика» тем, КОМУ адресован
   * вопрос: там работа идёт и ждать нужно подрядчика, здесь она сделана и ждут
   * НАС — забрать. Без этой фазы забытая у подрядчика готовая партия неотличима
   * от той, что ещё шьётся.
   */
  ready_at_contractor: 'Готово у подрядчика',
  returned: 'Ожидает приёмки',
  /**
   * Седьмое состояние документа: «3 шт. можно отправить подрядчику
   * на переделку, основные 97 при этом не блокируются». Это не «у подрядчика»:
   * там идёт основная работа, здесь — исправление брака, и путать их значит
   * не понимать, чего ждать и сколько.
   */
  rework: 'На переделке',
  accepted: 'Принято складом',
  closed: 'Завершено',
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

/**
 * Перемещение по подряду: передали / вернулось / приняли / брак.
 *
 * `defect` заведён правкой 22.08 (п. 3.9). До неё брак ВЫВОДИЛСЯ как
 * «вернулось − принято», и сразу после возврата экран показывал «брак: 200»
 * при том, что изделия просто ещё не проходили приёмку. Брак обязан
 * появляться только после того, как человек ЯВНО отметил количество, —
 * значит у него должна быть своя запись журнала, как у всех остальных
 * количеств подряда.
 */
export type SubcontractMoveKind = 'send' | 'return' | 'accept' | 'defect';

export const SUBCONTRACT_MOVE_LABELS: Record<SubcontractMoveKind, string> = {
  send: 'Передано подрядчику',
  return: 'Вернулось от подрядчика',
  accept: 'Принято складом',
  defect: 'Отмечено браком',
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
  mixed: 'Материалы смешанно',
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
   * Роли участков нанесения (правки 10.08, `dtg` — 20.08). По правам они
   * не различаются между собой — различает их привязка
   * `erp_employees.department_id`. Заведены отдельно, потому что заказчик
   * перечислил их как самостоятельные роли команды.
   */
  | 'dtf' | 'silkscreen' | 'embroidery' | 'dtg'
  /**
   * Заведён, должность не назначена — ЕДИНСТВЕННАЯ роль без единого права
   * (кроме `hr`, но та означает должность, а не состояние).
   *
   * С неё начинается каждая самостоятельная регистрация: её ставит триггер
   * `handle_new_user`. Без строки сотрудника `erp_role_of_caller()` выводит
   * роль из профиля и делает новичка менеджером — и «Подтвердить» в админке
   * выдавало заодно правку любого заказа, ТЗ и перенос этапов между цехами,
   * причём по всей фабрике: `manager` — роль сквозная, и ограничение по цеху
   * на человека без цеха для неё не действует (`canActInDept` fail-open).
   * Ролям участка пустая привязка с 22.08 закрывает действия целиком.
   */
  | 'pending';

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

/**
 * Приглашение по ссылке (`erp_invites`) — основной путь появления сотрудника.
 *
 * Код несёт РОЛЬ и ЦЕХ: человек, перешедший по ссылке, заводится сразу
 * одобренным и с правами, а админ делает ровно одно действие. Проверяет
 * и гасит код серверный триггер регистрации — клиент код только показывает.
 */
export interface ErpInvite {
  /** Секрет ссылки. uuid перебору недоступен, отдельного пароля у ссылки нет */
  code: string;
  /** Роль профиля Order Studio */
  profile_role: string;
  /** Цеховая роль ERP — вход в матрицу прав */
  employee_role: EmployeeRole;
  department_id: string | null;
  /** Привязка к адресу; null — ссылкой воспользуется любой, кому её дали */
  email: string | null;
  note: string | null;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  /** Отзыв, а не удаление: журнал «кто, кого и куда звал» остаётся */
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
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
  /**
   * Решение заказчика 12.08: разработку ведут технолог И конструктор, и это
   * ОДНА цеховая роль — та, у которой есть `experimental.manage`. Подпись
   * названа обеими профессиями, чтобы в админке было видно, кого назначать:
   * без роли человек, вписанный в поле «Конструктор» карточки разработки,
   * видел бы её только на чтение.
   *
   * Код роли (`technologist`) НЕ переименовывается — он зашит в CHECK
   * `erp_employees.role`, в матрицу `erp_role_permissions`, в
   * `erp_role_of_caller()` и в сторожевые тесты. Заказчику нужны НАЗВАНИЯ,
   * и они живут здесь (правило проекта).
   *
   * Поле `erp_experimental.technologist` — не про эту роль: там «Проработчик»,
   * ответственный за конкретную разработку. Совпадение имён случайно.
   */
  technologist: 'Конструктор / технолог',
  dtf: 'ДТФ',
  silkscreen: 'Шелкография',
  embroidery: 'Вышивка',
  dtg: 'DTG',
  /** Подпись называет СОСТОЯНИЕ, а не должность: это и есть смысл роли */
  pending: 'Без доступа — должность не назначена',
};

// --- Матрица прав (ядро правки 11) ------------------------------------------

/**
 * Перечисление прав переехало в `./permissionKeys` — его импортирует ОБОЛОЧКА,
 * и тянуть ради него весь этот файл со словарями подписей незачем
 * (см. комментарий там). Здесь остаётся реэкспорт: экранный код по-прежнему
 * берёт `ErpPermission` и `ERP_PERMISSIONS` из `types`.
 */
import type { ErpPermission } from './permissionKeys';

export type { ErpPermission } from './permissionKeys';
export { ERP_PERMISSIONS } from './permissionKeys';

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
  'warehouse.manage': 'Вести склад (приёмка, маркировка, упаковка)',
  'plan.manage': 'Вести производственный план',
  'plan.fact': 'Вносить факт по плану',
  'catalog.edit': 'Править справочники',
  'experimental.manage': 'Вести экспериментальный цех',
  'bypass.manage': 'Аварийно снимать блокировки',
  'staff.invite': 'Приглашать сотрудников ссылкой',
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
  'block_reason' | 'problem_type' | 'product_type' | 'supplier' | 'unit'
  | 'experimental_task_type' | 'route_operation' | 'label_type';

export const DICTIONARY_LABELS: Record<DictionaryKind, string> = {
  block_reason: 'Причины блокировок',
  problem_type: 'Типы проблем',
  product_type: 'Типы изделий',
  supplier: 'Поставщики',
  unit: 'Единицы измерения',
  experimental_task_type: 'Задачи разработки',
  route_operation: 'Операции маршрута',
  label_type: 'Типы бирок',
};

/** Подсказка под заголовком справочника — где значение всплывает в работе */
export const DICTIONARY_HINTS: Record<DictionaryKind, string> = {
  block_reason: 'Быстрый выбор в форме «Проблема» у задания цеха.',
  problem_type: 'Быстрый выбор при оформлении брака и переделки.',
  product_type: 'Подсказки в поле «Изделие» при создании заказа.',
  unit: 'Подсказки в поле единицы измерения материала (кг, м, шт).',
  supplier: 'Подсказки в поле «Поставщик» в закупке и материалах заказа.',
  experimental_task_type:
    'Типы задач в карточке разработки экспериментального цеха (лекала, подбор материала, примерка).',
  route_operation:
    'Подсказки в поле «Операция» у подрядного этапа маршрута (сублимация, спецоперация) — когда название расходится с именем цеха.',
  label_type:
    'Подсказки в блоке «Бирки» позиции заказа (размерник, составник, брендовая, по уходу).',
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

/**
 * Шкала упаковки ПОЗИЦИИ (правка заказчика 16.08). «Как в заказе» стоит первым
 * и служит значением по умолчанию: пустого значения нет намеренно — «не
 * заполняли» и «эту позицию не упаковывать» обязаны различаться, иначе забытая
 * позиция уедет в отгрузку без упаковки, и никто этого не заметит.
 */
export const ITEM_PACKAGING_LABELS: Record<ItemPackagingType, string> = {
  inherit: 'Как в заказе',
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

/**
 * Бирка позиции (правка 22.08, п. 5.3).
 *
 * ПОВТОРЯЕМЫЙ БЛОК, как нанесения: в заказе обычно размерник, составник,
 * брендовая и бирка по уходу, у каждой своё расположение и макет. Раньше
 * всё это лежало в ОДНОМ текстовом поле `labels_note` — оно осталось
 * в схеме ради заведённых заказов и показывается как «старое поле»,
 * пока не опустеет.
 *
 * Макет бирки — вложение с `label_id`, тем же приёмом, что макет нанесения.
 */
export interface ErpItemLabel {
  id: string;
  item_id: string;
  seq: number;
  /** Код из справочника `label_type`; ввод свободный */
  label_type: string | null;
  place: string | null;
  size: string | null;
  comment: string | null;
  created_at: string;
}

/**
 * Черновик формы создания заказа (правка 22.08, п. 5.5).
 *
 * ЭТО НЕ ЗАКАЗ. Снимок формы в JSON, своя таблица, никакой связи
 * с `erp_orders`: заказ со статусом «черновик» потребовал бы фильтра
 * в полутора десятках производственных поверхностей, и один забытый фильтр
 * отправил бы незаконченный заказ в цех.
 */
export interface ErpOrderDraft {
  id: string;
  author_id: string;
  /** Название заказа или № сделки — то, по чему человек узнаёт черновик */
  title: string | null;
  payload: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Заметка к заказу (правка 22.08, п. 5.8).
 *
 * То, что НЕЛЬЗЯ разложить по структурным полям: фото фурнитуры, референсы,
 * пояснения по биркам, нестандартные инструкции. Структурные поля она
 * не заменяет — документ говорит это прямо, иначе заметки станут свалкой,
 * из которой цех будет вычитывать ТЗ.
 *
 * Принадлежит ЗАКАЗУ, а не позиции. Изображения — вложения с `note_id`
 * и видом `note`: у каждого своя подпись, поэтому картинка привязана
 * к конкретной заметке.
 */
export interface ErpOrderNote {
  id: string;
  order_id: string;
  seq: number;
  text: string | null;
  author: string | null;
  created_at: string;
  updated_at: string;
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
