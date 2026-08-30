/**
 * Хелперы формы создания производственного заказа (CreateOrderModal):
 * черновик в localStorage, размерная сетка (пресеты, сумма, авторасчёт qty),
 * валидация с привязкой к полям.
 *
 * Чистые функции — покрыты тестами orderForm.test.ts.
 */

import { storageGet, storageRemove, storageSet } from '../../lib/storage';
import { factoryToday } from '../../utils/date';
import type { SizeGridRow } from '../types';
import type { RouteGroup } from './routeDraft';

export const ORDER_DRAFT_KEY = 'erp_order_draft';

/**
 * Пресеты размерной сетки.
 *
 * Взрослый ряд расширен до 3XS—5XL правкой заказчика 16.08: прежние семь
 * размеров (XS…3XL) не покрывали ни мелкие, ни крупные заказы, и такие размеры
 * приходилось добавлять режимом «Своя» — по одному, руками, на каждой позиции.
 *
 * Написание приведено к одному виду: `2XL` вместо прежнего `XXL` — иначе в одном
 * ряду стояли бы `XXL` и `3XL`, то есть два разных правила подряд. Прежние
 * заказы это не задевает: размеры хранятся КЛЮЧАМИ JSON внутри `size_grid`,
 * а всё, что их показывает (`OrderItemSection`, `TzBlock`), берёт ключи из самих
 * данных, а не из этого списка. В редакторе размер вне пресета тоже виден —
 * `SizeGridEditor` дописывает к пресету активные размеры сетки.
 */
export const SIZE_PRESETS: Record<'adult' | 'kids', readonly string[]> = {
  adult: ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'],
  kids: ['92', '98', '104', '110', '116', '122', '128', '134', '140', '146'],
};

export const SIZE_PRESET_LABELS: Record<'adult' | 'kids' | 'custom', string> = {
  adult: 'Взрослая',
  kids: 'Детская',
  custom: 'Своя',
};

// --- Черновые структуры формы (в state и localStorage) ------------------------

export interface DraftPrint {
  /**
   * Локальный ключ нанесения. Нужен ради МАКЕТА (правка 22.08, п. 5.2):
   * файл выбирается тогда, когда строки `erp_item_prints` ещё не существует,
   * и привязка идёт по ключу формы — тем же приёмом, что у строк листа
   * закупки. Индекс массива для этого не годится: удаление среднего
   * нанесения сдвинуло бы привязку у всех, кто ниже, и макет уехал бы
   * к чужой вышивке. В payload ключ не едет.
   */
  key: string;
  method: string;
  zone: string;
  width_mm: string | number;
  height_mm: string | number;
  offset_note: string;
  pantone: string;
  comment: string;
}

/**
 * Бирка позиции (правка 22.08, п. 5.3).
 *
 * «Сейчас используется одно общее текстовое поле Бирки. В реальном заказе
 * у изделия обычно может быть несколько бирок» — размерник, составник,
 * брендовая, по уходу, и у каждой своё расположение и свой макет.
 */
export interface DraftLabel {
  key: string;
  label_type: string;
  place: string;
  size: string;
  comment: string;
}

export interface DraftGrid {
  sizes?: string[];
  rows?: SizeGridRow[];
}

export interface DraftItem {
  product_type: string;
  variant: string;
  /**
   * Крой изделия (правка заказчика 16.08). Порядок заполнения по документу:
   * Изделие → Цвет → Крой → Размер → Количество — поле стоит между вариантом
   * и количеством и в форме тоже.
   */
  fit: string;
  qty: string | number;
  /** Технический блок изделия (правка 16.08): что цех должен знать о производстве */
  /**
   * Основное полотно (правка 22.08, п. 5.1). Отдельным полем: у изделия
   * бывает и основная ткань, и отделочная, а раньше было только второе.
   */
  main_fabric: string;
  trim_material: string;
  cutting_note: string;
  sewing_note: string;
  labels_note: string;
  /** Упаковка ПОЗИЦИИ; `inherit` — как в заказе (см. utils/packaging) */
  packaging: string;
  /**
   * Документ (п. 1) перечисляет их отдельными пунктами, и не зря: это читает
   * цех при упаковке, а из свободного комментария половина теряется при беглом
   * чтении. `packaging_note` остался «дополнительными требованиями».
   */
  packaging_size: string;
  sticker_place: string;
  marking_place: string;
  packaging_note: string;
  production_type: string;
  branding_on: string;
  /** Есть ли брендирование — управляет блоком нанесений и их валидацией */
  has_branding?: boolean;
  /** Подряд (волна 4.2): тип и источник материалов — для production_type='outsource' */
  subcontract_kind?: string;
  material_source?: string;
  /** Что за операция делает подрядчик (правка 4.2.3) — для «отдельной операции» */
  subcontract_operation?: string;
  /** Требуется ли доработка внутри Pinhead после отдельной операции (правка 4.2.3) */
  needs_further?: boolean;
  /** Следующий участок после отдельной операции подряда (код цеха) */
  return_dept?: string;
  prints: DraftPrint[];
  /** Бирки позиции (правка 22.08, п. 5.3) — повторяемый блок, как нанесения */
  labels: DraftLabel[];
  size_grid: DraftGrid | null;
  /**
   * Правка маршрута человеком (правки заказчика 16.08, блок 2).
   *
   * `undefined` — «маршрут не трогали, считать автоматически». Именно отсутствие,
   * а не пустой массив: пустой означал бы «маршрута нет вовсе», и заказ уехал бы
   * без единого этапа. Заказчик решил, что автоматический расчёт остаётся
   * предложением по умолчанию, а не заменяется ручной сборкой.
   *
   * Тип структурный (`RouteGroup[]` из `utils/routeDraft`), но в форме он живёт
   * как обычный JSON: черновик пишется через `JSON.stringify`, и ничего, кроме
   * строк, чисел и булевых, здесь быть не должно.
   */
  route?: RouteGroup[];
}

/**
 * Строка листа закупки в форме создания (правки заказчика 16.08).
 *
 * `key` — локальный идентификатор строки, только для React и правок: в payload
 * он не уезжает. Индекс массива для этого не годится — удаление средней строки
 * пересобрало бы все поля ниже.
 *
 * `qty_expected` строкой, а не числом: поле ввода отдаёт строку, и приведение
 * на каждое нажатие превращает «12.» в 12, не давая набрать «12.5».
 */
export interface DraftPurchaseRow {
  key: string;
  /** Индекс позиции заказа; null — материал на весь заказ */
  item_index: number | null;
  kind: string;
  role: string;
  name: string;
  color: string;
  qty_expected: string;
  unit: string;
  manager_note: string;
}

export function emptyPurchaseRow(key: string): DraftPurchaseRow {
  return {
    key,
    item_index: null,
    kind: 'fabric',
    role: 'main',
    name: '',
    color: '',
    qty_expected: '',
    unit: '',
    manager_note: '',
  };
}

/** Пустая строка листа: её не показываем в ошибках и не отправляем */
export function isPurchaseRowEmpty(r: DraftPurchaseRow): boolean {
  return !r.name.trim() && !r.color.trim() && !r.manager_note.trim()
    && !(Number(r.qty_expected) > 0);
}

export interface DraftForm {
  bitrix_id: string;
  title: string;
  /** Клиент — цех видит его в задании, по нему же фильтруют очередь (правки 5/9) */
  customer: string;
  manager: string;
  launch_date: string;
  due_date: string;
  buffer_days: string | number;
  packaging: string;
  packaging_note: string;
  stickers: string;
  stickers_note: string;
  no_chestny_znak: boolean;
  /**
   * Требуется ли закупка (правки заказчика 20.08). Отметка МЕНЕДЖЕРА, а не
   * вывод из пустого листа: «закупать нечего» и «до закупки ещё не дошли» —
   * разные состояния, и второе не должно молча закрывать заказу путь
   * к закупщику. `false` вырезает этап `supply` из маршрута.
   */
  purchase_required: boolean;
}

const EMPTY_PRINT_FIELDS = {
  method: 'embroidery',
  zone: '',
  width_mm: '',
  height_mm: '',
  offset_note: '',
  pantone: '',
  comment: '',
} as const;

/**
 * Новое нанесение. Функция, а не константа: у каждого свой ключ, по которому
 * к нему привязывается макет. Общий объект дал бы всем нанесениям один ключ,
 * то есть один макет на всех.
 */
export function emptyPrint(): DraftPrint {
  return { key: crypto.randomUUID(), ...EMPTY_PRINT_FIELDS };
}

export function emptyLabel(): DraftLabel {
  return { key: crypto.randomUUID(), label_type: '', place: '', size: '', comment: '' };
}

export const EMPTY_ITEM: DraftItem = {
  product_type: '',
  variant: '',
  fit: '',
  qty: '',
  main_fabric: '',
  trim_material: '',
  cutting_note: '',
  sewing_note: '',
  labels_note: '',
  // «Как в заказе» по умолчанию: пустое значение было бы неотличимо
  // от осознанного «эту позицию не упаковывать»
  packaging: 'inherit',
  packaging_size: '',
  sticker_place: '',
  marking_place: '',
  packaging_note: '',
  production_type: 'sewing',
  branding_on: 'cut',
  has_branding: false,
  subcontract_kind: 'finished_product',
  material_source: 'pinhead',
  subcontract_operation: '',
  needs_further: false,
  return_dept: '',
  prints: [],
  labels: [],
  size_grid: null,
};

export function emptyOrderForm(launchDate: string = factoryToday()): DraftForm {
  return {
    bitrix_id: '',
    title: '',
    customer: '',
    manager: '',
    launch_date: launchDate,
    due_date: '',
    buffer_days: '0',
    packaging: 'none',
    packaging_note: '',
    stickers: 'none',
    stickers_note: '',
    no_chestny_znak: false,
    purchase_required: true,
  };
}

// --- Размерная сетка ----------------------------------------------------------

/** Сумма количеств по АКТИВНЫМ размерам сетки (убранные чипсы не считаются) */
export function gridTotal(grid: DraftGrid | null | undefined): number {
  const rows = grid?.rows ?? [];
  const active = grid?.sizes ?? [];
  if (rows.length === 0 || active.length === 0) return 0;
  return rows.reduce(
    (sum, row) => sum + active.reduce((s, sz) => s + (Number(row.sizes?.[sz]) || 0), 0),
    0,
  );
}

/** Эффективное количество позиции: сетка заполнена → сумма сетки, иначе ручной ввод */
export function effectiveQty(item: Pick<DraftItem, 'qty' | 'size_grid'>): number {
  const total = gridTotal(item.size_grid);
  return total > 0 ? total : Number(item.qty) || 0;
}

/**
 * Добавить/убрать размер-чипс. Количества в rows НЕ теряются:
 * ключ остаётся в row.sizes и вернётся при повторном добавлении размера.
 */
export function toggleSize(grid: DraftGrid | null | undefined, size: string): DraftGrid {
  const sizes = grid?.sizes ?? [];
  const rows = grid?.rows ?? [];
  const next = sizes.includes(size) ? sizes.filter((s) => s !== size) : [...sizes, size];
  return { sizes: next, rows };
}

/** size_grid формы → payload: только активные размеры, пустые строки отброшены */
export function gridToPayload(grid: DraftGrid | null | undefined): SizeGridRow[] | null {
  const rows = grid?.rows ?? [];
  const active = grid?.sizes ?? [];
  if (rows.length === 0) return null;
  const out = rows
    .filter((r) => r.color.trim() || active.some((sz) => Number(r.sizes?.[sz]) > 0))
    .map((r) => ({
      color: r.color.trim() || '—',
      sizes: Object.fromEntries(
        active
          .filter((sz) => r.sizes?.[sz] !== undefined)
          .map((sz) => [sz, Number(r.sizes[sz]) || 0]),
      ),
    }));
  return out.length > 0 ? out : null;
}

// --- Пустота формы (для confirm при закрытии и автосейва) ----------------------

export function isItemEmpty(item: DraftItem): boolean {
  return (
    !item.product_type.trim() &&
    !item.variant.trim() &&
    !(Number(item.qty) > 0) &&
    item.prints.length === 0 &&
    gridTotal(item.size_grid) === 0 &&
    /**
     * Технический блок считается данными: позиция, где заполнен только
     * комментарий по пошиву, «пустой» не является. Иначе форма молча выбросила
     * бы её из заказа (пустые дополнительные строки пропускаются валидацией)
     * либо закрылась без подтверждения, унеся набранный текст.
     */
    !item.fit.trim() &&
    // Позиция с одной заполненной биркой пустой не является: иначе форма
    // молча выбросила бы её из заказа вместе с набранным текстом
    (item.labels ?? []).length === 0 &&
    !item.main_fabric.trim() &&
    !item.trim_material.trim() &&
    !item.cutting_note.trim() &&
    !item.sewing_note.trim() &&
    !item.labels_note.trim() &&
    (item.packaging === 'inherit' || !item.packaging) &&
    !item.packaging_note.trim()
  );
}

/** Пустая ли форма целиком (дата запуска по умолчанию не считается данными) */
export function isFormEmpty(
  form: DraftForm,
  items: DraftItem[],
  initialLaunchDate: string = '',
): boolean {
  const s = (v: string | number | undefined) => String(v ?? '').trim();
  return (
    !s(form.bitrix_id) &&
    !s(form.title) &&
    !s(form.customer) &&
    !s(form.manager) &&
    (!form.launch_date || form.launch_date === initialLaunchDate) &&
    !form.due_date &&
    !(Number(form.buffer_days) > 0) &&
    form.packaging === 'none' &&
    form.stickers === 'none' &&
    !s(form.packaging_note) &&
    !s(form.stickers_note) &&
    !form.no_chestny_znak &&
    items.every(isItemEmpty)
  );
}

// --- Валидация ------------------------------------------------------------------

export interface OrderFormValidation {
  /** Ошибки по ключам полей: title, launch_date, due_date, item_{i}_product_type, item_{i}_qty, item_{i}_prints */
  errors: Record<string, string>;
  /** Короткие названия незаполненных полей — для строки «Осталось заполнить: …» */
  missing: string[];
  /**
   * Поля, которые заполнены, но неверно. Раньше они попадали в `missing`, и
   * восстановленный назавтра черновик с вчерашней датой запуска блокировал кнопку
   * подсказкой «Осталось заполнить: Дата запуска» — при заполненном поле.
   */
  invalid: string[];
}

export function validateOrderForm(
  form: DraftForm,
  items: DraftItem[],
  today: string = factoryToday(),
  purchase: DraftPurchaseRow[] = [],
  /**
   * Приложен ли ФАЙЛ листа закупки (правки 20.08). Пятым аргументом и
   * необязательным — прежние вызовы обязаны работать как раньше.
   */
  hasPurchaseList = false,
): OrderFormValidation {
  const errors: Record<string, string> = {};
  const missing: string[] = [];
  const invalid: string[] = [];

  if (!form.title.trim()) {
    errors.title = 'Укажите название заказа';
    missing.push('Название');
  }
  /**
   * ДАТА ЗАПУСКА В ПРОШЛОМ — НЕ ОШИБКА (правка заказчика 30.08, п. 10).
   *
   * Проверки здесь больше нет, и это не пропуск: заказ, запущенный в цеху
   * раньше, чем его завели в ERP, переносится задним числом, и прежнее
   * правило запрещало такой перенос совсем — вместе с `min` у поля. Дата
   * запуска описывает ФАКТ и участвует в расчёте сроков и в плане; момент
   * появления записи ведёт `created_at` и он не подменяется.
   *
   * У срока клиента правило остаётся: там прошедшая дата — ошибка ввода.
   */
  if (form.due_date && form.due_date < today) {
    errors.due_date = 'Срок клиента в прошлом — проверьте дату';
    invalid.push('Срок клиента');
  }

  items.forEach((it, i) => {
    // пустую дополнительную строку пропускаем (как раньше)
    if (items.length > 1 && isItemEmpty(it) && !it.has_branding) return;
    const pos = items.length > 1 ? ` (поз. ${i + 1})` : '';
    if (!it.product_type.trim()) {
      errors[`item_${i}_product_type`] = 'Укажите изделие';
      missing.push(`Изделие${pos}`);
    }
    if (!(effectiveQty(it) > 0)) {
      errors[`item_${i}_qty`] = 'Количество должно быть больше 0';
      missing.push(`Кол-во${pos}`);
    }
    if (it.has_branding && it.prints.length === 0) {
      errors[`item_${i}_prints`] = 'Добавьте хотя бы одно нанесение';
      missing.push(`Нанесения${pos}`);
    }
    // Следующий участок после операции подряда. Раньше это была отдельная проверка
    // в сабмите с тостом: поле не подсвечивалось, автоскролл к нему не работал,
    // а само оно спрятано в глубине блока за двумя условиями.
    if (
      it.production_type === 'outsource'
      && (it.subcontract_kind ?? 'finished_product') === 'operation'
      && it.needs_further
      && !it.return_dept
    ) {
      errors[`item_${i}_return_dept`] = 'Выберите участок для доработки';
      missing.push(`Следующий участок${pos}`);
    }
  });

  /**
   * Лист закупки. Начатая строка обязана нести НАЗВАНИЕ и КОЛИЧЕСТВО — оба поля
   * подписаны звёздочкой, но не проверялись вовсе: заказ уезжал со строкой без
   * количества, а `supply.missingPlan` требует `qty_expected`, чтобы закрыть
   * закупку автоматически. То есть заказ создавался и молча вставал.
   *
   * Совсем пустая строка — не ошибка: её отбрасывает сам сабмит
   * (`isPurchaseRowEmpty`), и человек мог просто нажать «+ Позиция закупки».
   */
  /**
   * ОДНО ИЗ ДВУХ ОБЯЗАТЕЛЬНО (документ 20.08): либо приложен файл листа
   * закупки, либо явно отмечено «Закупка не требуется». «Если не выполнено
   * ни одно условие — заказ создать нельзя».
   *
   * Проверка стоит ЗДЕСЬ, а не в сабмите: только отсюда работают рамка,
   * `aria-invalid`, автоскролл и раскрытие секции. Тост для этого не годится —
   * правило волны UX-4.
   */
  if (form.purchase_required !== false && !hasPurchaseList) {
    errors.purchase_list = 'Приложите лист закупки или отметьте «Закупка не требуется»';
    missing.push('Лист закупки');
  }

  purchase.forEach((r, i) => {
    if (isPurchaseRowEmpty(r)) return;
    const pos = purchase.length > 1 ? ` (строка ${i + 1})` : '';
    if (!r.name.trim()) {
      errors[`purchase_${i}_name`] = 'Укажите материал';
      missing.push(`Материал закупки${pos}`);
    }
    if (!(Number(r.qty_expected) > 0)) {
      errors[`purchase_${i}_qty`] = 'Количество должно быть больше 0';
      missing.push(`Кол-во закупки${pos}`);
    }
  });

  return { errors, missing, invalid };
}

// --- Черновик в localStorage ------------------------------------------------------

interface OrderDraftEnvelope {
  form: DraftForm;
  items: DraftItem[];
  /** Лист закупки; в старых черновиках его нет вовсе */
  purchase?: DraftPurchaseRow[];
  /** Заметки к заказу; в черновиках до 22.08 их нет */
  notes?: DraftNote[];
  savedAt: string;
}

/** Заметка к заказу в черновике формы (правка 22.08, п. 5.8) */
export interface DraftNote {
  key: string;
  text: string;
}

export interface OrderDraft {
  form: DraftForm;
  items: DraftItem[];
  purchase: DraftPurchaseRow[];
  notes: DraftNote[];
}

/**
 * Привести снимок формы к нынешней структуре.
 *
 * ОДНА функция и для локального черновика, и для строки из базы (правка 22.08,
 * п. 5.5): снимки, сделанные раньше, лежат и там, и там, а дописывание ключей
 * нанесениям и подстановка новых полей — правило одно. Вторая копия рядом
 * означала бы, что часть черновиков чинится, а часть нет.
 *
 * `null` — снимка нет или он битый: форма откроется чистой, а не упадёт.
 */
export function normalizeDraft(raw: unknown): OrderDraft | null {
  const env = raw as OrderDraftEnvelope | null;
  if (!env || typeof env !== 'object') return null;
  if (!env.form || typeof env.form !== 'object') return null;
  if (!Array.isArray(env.items) || env.items.length === 0) return null;
  return normalizeEnvelope(env);
}

/** Восстановить локальный черновик прежней версии; null — его нет или он битый */
export function loadOrderDraft(): OrderDraft | null {
  return normalizeDraft(storageGet<OrderDraftEnvelope>(ORDER_DRAFT_KEY));
}

function normalizeEnvelope(raw: OrderDraftEnvelope): OrderDraft {
  return {
    form: { ...emptyOrderForm(), ...raw.form },
    items: raw.items.map((it) => ({
      ...EMPTY_ITEM,
      ...it,
      /**
       * Ключи дописываются восстановленному черновику: он мог быть сохранён
       * до правки 22.08, а без ключа макет не к чему привязать.
       */
      prints: (Array.isArray(it.prints) ? it.prints : [])
        .map((p) => ({ ...p, key: p.key || crypto.randomUUID() })),
      labels: (Array.isArray(it.labels) ? it.labels : [])
        .map((l) => ({ ...l, key: l.key || crypto.randomUUID() })),
      // старые черновики без флага: брендирование — если есть нанесения
      has_branding: it.has_branding ?? (Array.isArray(it.prints) && it.prints.length > 0),
    })),
    /**
     * Черновик, сохранённый до появления листа закупки, отдаёт пустой лист,
     * а не роняет восстановление: человек мог начать заказ вчера.
     */
    purchase: Array.isArray(raw.purchase)
      ? raw.purchase.map((r, i) => ({ ...emptyPurchaseRow(r.key || `p${i}`), ...r }))
      : [],
    notes: Array.isArray(raw.notes)
      ? raw.notes.map((n) => ({ ...n, text: n.text ?? '', key: n.key || crypto.randomUUID() }))
      : [],
  };
}

export function saveOrderDraft(
  form: DraftForm,
  items: DraftItem[],
  purchase: DraftPurchaseRow[] = [],
  notes: DraftNote[] = [],
): void {
  storageSet(ORDER_DRAFT_KEY, {
    form, items, purchase, notes, savedAt: new Date().toISOString(),
  });
}

export function clearOrderDraft(): void {
  storageRemove(ORDER_DRAFT_KEY);
}
