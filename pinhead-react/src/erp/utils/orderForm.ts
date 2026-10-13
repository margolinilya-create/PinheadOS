/**
 * Хелперы формы создания производственного заказа (CreateOrderModal):
 * черновик в localStorage, размерная сетка (пресеты, сумма, авторасчёт qty),
 * валидация с привязкой к полям.
 *
 * Чистые функции — покрыты тестами orderForm.test.ts.
 */

import { factoryToday } from '../../utils/date';
import type { SizeGridRow } from '../types';
import type { RouteGroup } from './routeDraft';
// Реэкспорт ниже имени в модуль не вводит — пустоте формы нужен импорт
import { gridTotal } from './orderFormGrid';

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
 *
 * `ONE` (безразмерный) добавлен правкой 07.09, п. 7: заказчик перечислил его
 * среди колонок сетки. Шапки, бейсболки и сумки шьются одним размером, и до
 * правки его приходилось заводить режимом «Своя» на каждой позиции. `3XS`
 * и `5XL` остаются — они встречаются в заведённых заказах.
 */
export const SIZE_PRESETS: Record<'adult' | 'kids', readonly string[]> = {
  adult: ['3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'ONE'],
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
  /** Id существующего нанесения — только в режиме правки (правка 12.09, п. 7) */
  id?: string;
  method: string;
  zone: string;
  width_mm: string | number;
  height_mm: string | number;
  offset_note: string;
  pantone: string;
  /**
   * Спецэффект — ТОЛЬКО у шелкографии (правки 07.09, п. 10). Пишется
   * в существующую колонку `erp_item_prints.special`: она заведена 17.07
   * и до правки была пуста у всех нанесений — ни форма, ни RPC её не писали.
   */
  special: string;
  /** Тип изделия — ТОЛЬКО у вышивки (правки 07.09, п. 11) */
  garment_kind: string;
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
  /** Id существующей бирки — в режиме правки (правка 12.09, п. 7) */
  id?: string;
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
  /**
   * Id существующей позиции — только в режиме ПРАВКИ (правка 12.09, п. 7).
   * По нему сервер сопоставляет строки; индекс массива для этого не годится:
   * удаление средней позиции сдвинуло бы все следующие, и техблок уехал бы
   * к чужому изделию. У новой позиции его нет вовсе.
   */
  id?: string;
  /**
   * Ключ строки ФОРМЫ — не колонка и в базу не уходит (обзор 26.09, п. 23).
   * По нему React отличает позиции при удалении: пока ключом был индекс,
   * у следующей позиции «переезжало» состояние соседки — раскрытые `<details>`
   * техблока, упаковки и бирок. Ключ есть у каждой позиции: `newDraftItem()`,
   * копия, восстановленный черновик и заказ из базы его дописывают.
   */
  key?: string;
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
  /**
   * Цвет материала и поставщик одной строкой (правка 12.09, п. 3).
   * НЕ цвет изделия: тот живёт в `variant` и в строках размерной сетки.
   * Здесь — «из чего и у кого», так эту пару и называет закупка.
   */
  color_supplier: string;
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
  /** Размер упаковки позиции, мм (правки 07.09, п. 16); пусто — как в заказе */
  packaging_width_mm: string | number;
  packaging_height_mm: string | number;
  production_type: string;
  /**
   * Чьё готовое изделие (правки 07.09, п. 4): `purchased` — закупаем мы,
   * `customer` — давальческое. Спрашивается только у `ready_garment`,
   * разбирается `utils/garmentSource`.
   */
  garment_source?: string;
  /**
   * Модель из каталога SKU (правка 14.09, п. 6) — ССЫЛКА, а не замена полей.
   * `product_type`, `fit`, ткань и сетка остаются собственными полями позиции:
   * это СНИМОК на момент заказа, и правка карточки задним числом не имеет
   * права переписать действующий заказ. Пустая строка — «не из каталога»
   * и она же отвязывает выбранную по ошибке модель.
   */
  sku_card_id?: string;
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
 * ФОРМА ИХ БОЛЬШЕ НЕ ПОКАЗЫВАЕТ И НЕ СОХРАНЯЕТ (правки 07.09, п. 14) —
 * тип остался ради ВОССТАНОВЛЕНИЯ: снимки, сделанные до правки, лежат
 * и в localStorage, и в `erp_order_drafts`, и `normalizeDraft` обязан
 * разбирать их, не падая. При первом же автосохранении секция уходит.
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

/*
  `isPurchaseRowEmpty` снят 07.09 вместе со строками листа закупки (п. 14):
  отправлять их некому, и «пустая ли строка» перестало быть вопросом.
  `DraftPurchaseRow` и `emptyPurchaseRow` рядом ОСТАЛИСЬ — их зовёт
  `normalizeEnvelope`, восстанавливая черновики, начатые до правки.
*/

export interface DraftForm {
  bitrix_id: string;
  title: string;
  /** Клиент — цех видит его в задании, по нему же фильтруют очередь (правки 5/9) */
  customer: string;
  manager: string;
  launch_date: string;
  due_date: string;
  /**
   * «Буфер, дн.» УБРАН ИЗ ФОРМЫ (правки заказчика 07.09, п. 2).
   *
   * Колонка `erp_orders.buffer_days` остаётся: её несут заведённые заказы
   * (46 из 47 стоят 0, один 5), и история правок подписывает её в
   * `HistorySection`. Убрана ровно точка ВВОДА — в расчёте дедлайнов поле
   * не участвовало никогда: `stagePlan.defaultPlannedEnd` считает от
   * `due_date` и `launch_date`, просрочка — от `due_date`.
   */
  packaging: string;
  packaging_note: string;
  /** Размер выбранной упаковки, мм (правки 07.09, п. 16) */
  packaging_width_mm: string | number;
  packaging_height_mm: string | number;
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
  special: '',
  garment_kind: '',
  comment: '',
} as const;

/** Новая позиция формы — со своим ключом строки (см. `DraftItem.key`) */
export function newDraftItem(patch: Partial<DraftItem> = {}): DraftItem {
  return { ...EMPTY_ITEM, key: crypto.randomUUID(), ...patch };
}

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
  color_supplier: '',
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
  packaging_width_mm: '',
  packaging_height_mm: '',
  production_type: 'sewing',
  // «Закупаем мы» — прежнее поведение готового изделия; давальческое
  // менеджер отмечает сам (правки 07.09, п. 4)
  garment_source: 'purchased',
  // «Не из каталога» — умолчание: модель выбирают явно
  sku_card_id: '',
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
    packaging: 'none',
    packaging_note: '',
    packaging_width_mm: '',
    packaging_height_mm: '',
    stickers: 'none',
    stickers_note: '',
    no_chestny_znak: false,
    purchase_required: true,
  };
}

// --- Куда наносится: «на крое» / «на готовом» ---------------------------------

export const BRANDING_ON_LABELS: Record<string, string> = {
  cut: 'на крое',
  finished: 'на готовом',
};

/**
 * Допустимые значения «Нанесение на» для типа производства
 * (правки заказчика 07.09, п. 8).
 *
 * У ГОТОВОГО ИЗДЕЛИЯ КРОЯ НЕТ ВОВСЕ: `BASE_CHAIN.ready_garment` закройного
 * цеха не содержит, и `buildRoute` в любом случае ставит ветку нанесения
 * в конец цепочки (`brandAfterCut` там ложно по построению). То есть «на крое»
 * был выбором БЕЗ ПОСЛЕДСТВИЙ — человек выбирал одно, система делала другое,
 * а ТЗ уезжало цеху с неправдой.
 */
export function brandingOnOptions(productionType: string): string[] {
  return productionType === 'ready_garment' ? ['finished'] : ['cut', 'finished'];
}

/**
 * Привести уже выбранное значение к допустимому.
 *
 * Это ВТОРАЯ ПОЛОВИНА правила, и без неё первая ничего не решает: селект
 * про смену типа производства не знает, и позиция, переключённая на «Готовое
 * изделие» ПОСЛЕ выбора «на крое», уехала бы в payload с `branding_on: 'cut'`.
 * Поэтому правило живёт здесь, а не в разметке.
 */
export function normalizeBrandingOn(productionType: string, brandingOn: string): string {
  const allowed = brandingOnOptions(productionType);
  return allowed.includes(brandingOn) ? brandingOn : allowed[0];
}

// --- Размерная сетка — `orderFormGrid.ts` (вынесено 26.09, реэкспорт) -------

export { gridTotal, rowTotal, effectiveQty, toggleSize, gridToPayload } from './orderFormGrid';

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
    !item.color_supplier.trim() &&
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
    form.packaging === 'none' &&
    form.stickers === 'none' &&
    !s(form.packaging_note) &&
    !s(form.stickers_note) &&
    !form.no_chestny_znak &&
    items.every(isItemEmpty)
  );
}

// --- Валидация — `orderFormValidation.ts` (вынесено 08.10, реэкспорт) -------

export { orderNeedsPurchase, validateOrderForm } from './orderFormValidation';
export type { OrderFormValidation } from './orderFormValidation';

// --- Черновик ------------------------------------------------------------------

/*
  Снимок черновика (типы, нормализация, локальный перенос прежней версии)
  живёт в `orderDraftEnvelope.ts` (вынос 27.09, правка 12: файлы черновика).
  Реэкспорт держит прежние импорты живыми.
*/
export {
  normalizeDraft,
  loadOrderDraft,
  clearOrderDraft,
  fileNameFromPath, isDraftEmpty,
} from './orderDraftEnvelope';
export type {
  OrderDraft,
  DraftNote,
  DraftAttachment,
  DraftTzDoc,
} from './orderDraftEnvelope';

// --- Существующий заказ → черновик формы (правка 12.09, п. 7) ------------------

/**
 * ОБРАТНОЕ ПРЕОБРАЗОВАНИЕ: заказ из базы → состояние формы.
 *
 * ЗАЧЕМ. «В карточке уже созданного заказа добавить действие „Редактировать".
 * По нажатию должна открываться форма заказа с уже заполненными текущими
 * значениями». Форма одна на оба пути — создание и правку, — и вторая её
 * копия разошлась бы с первой в первую же правку; значит нужен переводчик
 * в обратную сторону, которого в проекте не было вовсе.
 *
 * ДВА ПРАВИЛА, БЕЗ КОТОРЫХ ЭТО ЛОМАЕТСЯ МОЛЧА.
 *
 * 1. NULL СТАНОВИТСЯ ПУСТОЙ СТРОКОЙ. В базе «не заполнено» — это NULL,
 *    в форме — `''`. Положив NULL в контролируемый `<input>`, React делает
 *    поле неуправляемым и роняет предупреждение, а человек видит поле,
 *    которое «не печатается».
 *
 * 2. РАЗМЕРЫ БЕРУТСЯ ИЗ КЛЮЧЕЙ ДАННЫХ, А НЕ ИЗ ПРЕСЕТА. `size_grid` хранит
 *    размеры ключами объекта (правило проекта: пресет можно менять без
 *    миграции), и заказ, заведённый со старым набором, обязан открыться
 *    со СВОИМИ размерами. Взяв `SIZE_PRESETS`, мы показали бы человеку
 *    не то, что он вводил, и первое же сохранение стёрло бы столбцы.
 *
 * Ключи нанесений и бирок генерируются заново: в базе их нет (там `id`),
 * а форме они нужны, чтобы привязывать макеты к строкам. Сам `id` едет
 * рядом — по нему сервер сопоставляет строки при сохранении, и индекс
 * массива для этого не годится: удаление средней строки сдвинуло бы всё
 * ниже, и техблок уехал бы к чужой позиции.
 */
export interface OrderLike {
  bitrix_id?: string | null;
  title?: string | null;
  customer?: string | null;
  manager?: string | null;
  launch_date?: string | null;
  due_date?: string | null;
  packaging?: string | null;
  packaging_note?: string | null;
  packaging_width_mm?: number | null;
  packaging_height_mm?: number | null;
  stickers?: string | null;
  stickers_note?: string | null;
  no_chestny_znak?: boolean | null;
  purchase_required?: boolean | null;
  items?: readonly Record<string, unknown>[];
}

/** NULL/undefined → пустая строка; число остаётся числом только там, где надо */
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Размеры сетки — объединение ключей ВСЕХ строк, в порядке появления */
function sizesOfGrid(rows: readonly SizeGridRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    for (const size of Object.keys(r?.sizes ?? {})) {
      if (!out.includes(size)) out.push(size);
    }
  }
  return out;
}

export function draftFromOrder(order: OrderLike): { form: DraftForm; items: DraftItem[] } {
  const form: DraftForm = {
    bitrix_id: str(order.bitrix_id),
    title: str(order.title),
    customer: str(order.customer),
    manager: str(order.manager),
    launch_date: str(order.launch_date),
    due_date: str(order.due_date),
    packaging: str(order.packaging) || 'none',
    packaging_note: str(order.packaging_note),
    packaging_width_mm: str(order.packaging_width_mm),
    packaging_height_mm: str(order.packaging_height_mm),
    stickers: str(order.stickers) || 'none',
    stickers_note: str(order.stickers_note),
    no_chestny_znak: order.no_chestny_znak === true,
    // Отсутствие колонки читается как «закупка нужна» — то же умолчание,
    // что у формы создания и у расчёта маршрута
    purchase_required: order.purchase_required !== false,
  };

  const items = (order.items ?? []).map((raw) => {
    const it = raw as Record<string, unknown>;
    const rows = Array.isArray(it.size_grid) ? (it.size_grid as SizeGridRow[]) : [];
    const prints = Array.isArray(it.prints) ? it.prints : [];
    const labels = Array.isArray(it.labels) ? it.labels : [];
    return {
      ...EMPTY_ITEM,
      key: crypto.randomUUID(),
      id: str(it.id) || undefined,
      product_type: str(it.product_type),
      variant: str(it.variant),
      fit: str(it.fit),
      qty: it.qty ?? '',
      main_fabric: str(it.main_fabric),
      color_supplier: str(it.color_supplier),
      trim_material: str(it.trim_material),
      cutting_note: str(it.cutting_note),
      sewing_note: str(it.sewing_note),
      labels_note: str(it.labels_note),
      packaging: str(it.packaging) || 'inherit',
      packaging_size: str(it.packaging_size),
      sticker_place: str(it.sticker_place),
      marking_place: str(it.marking_place),
      packaging_note: str(it.packaging_note),
      packaging_width_mm: str(it.packaging_width_mm),
      packaging_height_mm: str(it.packaging_height_mm),
      production_type: str(it.production_type) || 'sewing',
      garment_source: str(it.garment_source) || 'purchased',
      // Связь с моделью каталога: без неё правка заказа ОТВЯЗЫВАЛА бы модель —
      // форма прислала бы ключ с пустым значением, а сервер честно его принял
      sku_card_id: str(it.sku_card_id),
      branding_on: str(it.branding_on) || 'cut',
      // Признак формы, а не колонка: нанесения есть — блок раскрыт
      has_branding: prints.length > 0,
      subcontract_kind: str(it.subcontract_kind) || 'finished_product',
      material_source: str(it.material_source) || 'pinhead',
      prints: (prints as Record<string, unknown>[]).map((p) => ({
        ...emptyPrint(),
        id: str(p.id) || undefined,
        method: str(p.method) || 'embroidery',
        zone: str(p.zone),
        width_mm: p.width_mm ?? '',
        height_mm: p.height_mm ?? '',
        offset_note: str(p.offset_note),
        pantone: str(p.pantone),
        special: str(p.special),
        garment_kind: str(p.garment_kind),
        comment: str(p.comment),
      })),
      labels: (labels as Record<string, unknown>[]).map((l) => ({
        ...emptyLabel(),
        id: str(l.id) || undefined,
        label_type: str(l.label_type),
        place: str(l.place),
        size: str(l.size),
        comment: str(l.comment),
      })),
      size_grid: rows.length > 0 ? { sizes: sizesOfGrid(rows), rows } : null,
    } as DraftItem;
  });

  // Заказ без позиций в форме не открывается пустым: одна пустая позиция —
  // то же состояние, что у нового заказа, иначе править было бы нечего
  return { form, items: items.length > 0 ? items : [newDraftItem()] };
}
