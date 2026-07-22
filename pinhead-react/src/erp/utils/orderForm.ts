/**
 * Хелперы формы создания производственного заказа (CreateOrderModal):
 * черновик в localStorage, размерная сетка (пресеты, сумма, авторасчёт qty),
 * валидация с привязкой к полям.
 *
 * Чистые функции — покрыты тестами orderForm.test.ts.
 */

import { storageGet, storageRemove, storageSet } from '../../lib/storage';
import type { SizeGridRow } from '../types';

export const ORDER_DRAFT_KEY = 'erp_order_draft';

/** Пресеты размерной сетки */
export const SIZE_PRESETS: Record<'adult' | 'kids', readonly string[]> = {
  adult: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  kids: ['92', '98', '104', '110', '116', '122', '128', '134', '140', '146'],
};

export const SIZE_PRESET_LABELS: Record<'adult' | 'kids' | 'custom', string> = {
  adult: 'Взрослая',
  kids: 'Детская',
  custom: 'Своя',
};

// --- Черновые структуры формы (в state и localStorage) ------------------------

export interface DraftPrint {
  method: string;
  zone: string;
  width_mm: string | number;
  height_mm: string | number;
  offset_note: string;
  pantone: string;
  comment: string;
}

export interface DraftGrid {
  sizes?: string[];
  rows?: SizeGridRow[];
}

export interface DraftItem {
  product_type: string;
  variant: string;
  qty: string | number;
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
  size_grid: DraftGrid | null;
}

export interface DraftForm {
  bitrix_id: string;
  title: string;
  manager: string;
  launch_date: string;
  due_date: string;
  buffer_days: string | number;
  packaging: string;
  packaging_note: string;
  stickers: string;
  stickers_note: string;
  no_chestny_znak: boolean;
}

export const EMPTY_PRINT: DraftPrint = {
  method: 'embroidery',
  zone: '',
  width_mm: '',
  height_mm: '',
  offset_note: '',
  pantone: '',
  comment: '',
};

export const EMPTY_ITEM: DraftItem = {
  product_type: '',
  variant: '',
  qty: '',
  production_type: 'sewing',
  branding_on: 'cut',
  has_branding: false,
  subcontract_kind: 'finished_product',
  material_source: 'pinhead',
  subcontract_operation: '',
  needs_further: false,
  return_dept: '',
  prints: [],
  size_grid: null,
};

/** Сегодня в локальной таймзоне (YYYY-MM-DD) — дефолт даты запуска */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyOrderForm(launchDate: string = localToday()): DraftForm {
  return {
    bitrix_id: '',
    title: '',
    manager: '',
    launch_date: launchDate,
    due_date: '',
    buffer_days: '0',
    packaging: 'none',
    packaging_note: '',
    stickers: 'none',
    stickers_note: '',
    no_chestny_znak: false,
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
    gridTotal(item.size_grid) === 0
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
}

export function validateOrderForm(
  form: DraftForm,
  items: DraftItem[],
  today: string = localToday(),
): OrderFormValidation {
  const errors: Record<string, string> = {};
  const missing: string[] = [];

  if (!form.title.trim()) {
    errors.title = 'Укажите название заказа';
    missing.push('Название');
  }
  if (form.launch_date && form.launch_date < today) {
    errors.launch_date = 'Дата запуска в прошлом — проверьте дату';
    missing.push('Дата запуска');
  }
  if (form.due_date && form.due_date < today) {
    errors.due_date = 'Срок клиента в прошлом — проверьте дату';
    missing.push('Срок клиента');
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
  });

  return { errors, missing };
}

// --- Черновик в localStorage ------------------------------------------------------

interface OrderDraftEnvelope {
  form: DraftForm;
  items: DraftItem[];
  savedAt: string;
}

/** Восстановить черновик; null — если черновика нет или он битый */
export function loadOrderDraft(): { form: DraftForm; items: DraftItem[] } | null {
  const raw = storageGet<OrderDraftEnvelope>(ORDER_DRAFT_KEY);
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.form || typeof raw.form !== 'object') return null;
  if (!Array.isArray(raw.items) || raw.items.length === 0) return null;
  return {
    form: { ...emptyOrderForm(), ...raw.form },
    items: raw.items.map((it) => ({
      ...EMPTY_ITEM,
      ...it,
      prints: Array.isArray(it.prints) ? it.prints : [],
      // старые черновики без флага: брендирование — если есть нанесения
      has_branding: it.has_branding ?? (Array.isArray(it.prints) && it.prints.length > 0),
    })),
  };
}

export function saveOrderDraft(form: DraftForm, items: DraftItem[]): void {
  storageSet(ORDER_DRAFT_KEY, { form, items, savedAt: new Date().toISOString() });
}

export function clearOrderDraft(): void {
  storageRemove(ORDER_DRAFT_KEY);
}
