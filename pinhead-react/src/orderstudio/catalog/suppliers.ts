/**
 * Поставщики и палитры (веха 4, задача 3) — чистые функции над справочником
 * `catalog_config.suppliers` (`Supplier[]`, типы — `./types`).
 *
 * Два потребителя:
 *   · заказ — какая палитра у ткани (`supplierForFabric`), как найти цвет по коду
 *     (`findPaletteColor`), что предлагать (`offeredColors`);
 *   · редактор «Поставщики и палитры» — правки без мутаций и проверка перед
 *     сохранением (`validateSuppliers`, зеркало проверок `catalog_put` плюс
 *     «одно имя ткани — одна палитра», которую сервер не проверяет).
 *
 * Справочник — подсказка: снятый цвет (`active: false`) в заказ не предлагается,
 * но находится по коду — заказ, где он уже стоит, показывает его как есть.
 */
import type { PaletteColor, PaletteGroup, Supplier } from './types';

/** Ткань для привязки: важен только поставщик (`fabricsCatalog[].supplier`) */
export interface FabricLike {
  supplier?: string | null;
}

/** Hex цвета палитры — строго `#RRGGBB`, как проверяет `catalog_put` */
const HEX6 = /^#[0-9A-Fa-f]{6}$/;

export function isValidHex(hex: unknown): boolean {
  return typeof hex === 'string' && HEX6.test(hex);
}

/** Палитра по умолчанию: отмеченная; отмеченной нет (данные мимо редактора) — первая */
export function defaultSupplier(suppliers: readonly Supplier[]): Supplier | null {
  return suppliers.find((s) => s.isDefault) ?? suppliers[0] ?? null;
}

/**
 * Палитра ткани: поставщик, к которому привязано имя поставщика ткани
 * (`fabricSupplierNames`), иначе палитра по умолчанию. Снятый с продажи
 * поставщик не привязывает. Ткани нет — `null` (палитру не трогать).
 */
export function supplierForFabric(fabric: FabricLike | null | undefined, suppliers: readonly Supplier[]): Supplier | null {
  if (!fabric) return null;
  const name = (fabric.supplier ?? '').trim();
  const bound = name
    ? suppliers.find((s) => s.active && s.fabricSupplierNames.some((n) => n.trim() === name))
    : undefined;
  return bound ?? defaultSupplier(suppliers);
}

/**
 * Цвет по коду: сначала палитра поставщика ткани (`preferred`), затем все
 * палитры. Снятые тоже находятся. Не нашёлся (свободный текст) — `null`.
 */
export function findPaletteColor(
  code: string,
  suppliers: readonly Supplier[],
  preferred?: Supplier | null,
): PaletteColor | null {
  const c = (code ?? '').trim();
  if (!c) return null;
  const own = preferred?.palette.colors.find((x) => x.code === c);
  if (own) return own;
  for (const s of suppliers) {
    const hit = s.palette.colors.find((x) => x.code === c);
    if (hit) return hit;
  }
  return null;
}

/** Поставщик, в палитре которого код (для подписи «из палитры …») */
export function codeOwner(suppliers: readonly Supplier[], code: string): Supplier | null {
  return suppliers.find((s) => s.palette.colors.some((c) => c.code === code)) ?? null;
}

/** Что предлагается в заказ: только активные цвета */
export function offeredColors(supplier: Supplier | null | undefined): PaletteColor[] {
  return supplier ? supplier.palette.colors.filter((c) => c.active) : [];
}

/** Имена поставщиков у тканей каталога — без повторов и пустых, по алфавиту */
export function fabricSupplierNamesOf(fabrics: readonly FabricLike[]): string[] {
  const names = new Set<string>();
  for (const f of fabrics) {
    const n = (f.supplier ?? '').trim();
    if (n) names.add(n);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ru'));
}

// ── Правки справочника (без мутаций) ─────────────────────────────────────

function mapSupplier(list: readonly Supplier[], id: string, fn: (s: Supplier) => Supplier): Supplier[] {
  return list.map((s) => (s.id === id ? fn(s) : s));
}

export function updateSupplier(list: readonly Supplier[], id: string, patch: Partial<Omit<Supplier, 'id' | 'palette'>>): Supplier[] {
  return mapSupplier(list, id, (s) => ({ ...s, ...patch }));
}

/** Палитра по умолчанию — ровно одна: отметка снимается с остальных */
export function setDefaultSupplier(list: readonly Supplier[], id: string): Supplier[] {
  return list.map((s) => ({ ...s, isDefault: s.id === id }));
}

/**
 * Привязать имя поставщика ткани к палитре (или отвязать). Привязка ПЕРЕНОСИТСЯ:
 * имя снимается с другой палитры — одно имя не бывает у двух.
 */
export function bindFabricName(list: readonly Supplier[], id: string, name: string, on: boolean): Supplier[] {
  return list.map((s) => {
    const rest = s.fabricSupplierNames.filter((n) => n !== name);
    if (s.id === id && on) return { ...s, fabricSupplierNames: [...rest, name] };
    return rest.length === s.fabricSupplierNames.length ? s : { ...s, fabricSupplierNames: rest };
  });
}

export function updateColor(list: readonly Supplier[], id: string, code: string, patch: Partial<PaletteColor>): Supplier[] {
  return mapSupplier(list, id, (s) => ({
    ...s,
    palette: { ...s.palette, colors: s.palette.colors.map((c) => (c.code === code ? { ...c, ...patch } : c)) },
  }));
}

/** Правка цвета по месту в палитре — у нового цвета код ещё пуст или повторяется */
export function updateColorAt(list: readonly Supplier[], id: string, index: number, patch: Partial<PaletteColor>): Supplier[] {
  return mapSupplier(list, id, (s) => ({
    ...s,
    palette: { ...s.palette, colors: s.palette.colors.map((c, i) => (i === index ? { ...c, ...patch } : c)) },
  }));
}

export function addColor(list: readonly Supplier[], id: string, color: Omit<PaletteColor, 'active'>): Supplier[] {
  return mapSupplier(list, id, (s) => ({
    ...s,
    palette: { ...s.palette, colors: [...s.palette.colors, { ...color, active: true }] },
  }));
}

/** Новый id в пределах занятых: `<основа>-<n>` */
function freeId(base: string, taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function addGroup(list: readonly Supplier[], id: string, label: string): Supplier[] {
  return mapSupplier(list, id, (s) => {
    const group: PaletteGroup = { id: freeId(s.id, s.palette.groups.map((g) => g.id)), label };
    return { ...s, palette: { ...s.palette, groups: [...s.palette.groups, group] } };
  });
}

export function updateGroup(list: readonly Supplier[], id: string, groupId: string, label: string): Supplier[] {
  return mapSupplier(list, id, (s) => ({
    ...s,
    palette: { ...s.palette, groups: s.palette.groups.map((g) => (g.id === groupId ? { ...g, label } : g)) },
  }));
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Устойчивый латинский id из названия: «Рутекс» → `ruteks`; занят или пуст — с номером */
function supplierId(name: string, taken: readonly string[]): string {
  const slug = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug && !taken.includes(slug)) return slug;
  return freeId(slug || 'supplier', taken);
}

/** Новый поставщик — пустая палитра, без привязок (свой цвет текстом) */
export function addSupplier(list: readonly Supplier[], name: string): Supplier[] {
  const id = supplierId(name, list.map((s) => s.id));
  return [...list, {
    id, name, isDefault: false, fabricSupplierNames: [], active: true,
    palette: { groups: [], colors: [] },
  }];
}

// ── Проверка перед сохранением ───────────────────────────────────────────

export interface SuppliersCheck {
  /** Ошибки — сохранение закрыто (текстом для экрана) */
  errors: string[];
  /** Коды, которые встречаются больше одного раза по всем палитрам */
  duplicateCodes: string[];
  /** Имена поставщиков тканей без привязки — получают палитру по умолчанию */
  unbound: string[];
}

/**
 * Проверка справочника: то, что отклонил бы `catalog_put` (пустые поля, hex,
 * повтор кода, палитра по умолчанию — ровно одна), плюс «одно имя ткани —
 * не больше одной палитры». `fabricNames` — имена поставщиков у тканей каталога.
 */
export function validateSuppliers(list: readonly Supplier[], fabricNames: readonly string[]): SuppliersCheck {
  const errors: string[] = [];
  const defaults = list.filter((s) => s.isDefault).length;
  if (defaults !== 1) errors.push('Палитра по умолчанию должна быть ровно одна');
  for (const s of list) {
    if (!s.name.trim()) errors.push('У поставщика нет названия');
  }

  const seen = new Map<string, number>();
  for (const s of list) {
    for (const c of s.palette.colors) {
      const code = c.code.trim();
      if (!code) errors.push(`Палитра «${s.name}»: у цвета нет кода`);
      else seen.set(code, (seen.get(code) ?? 0) + 1);
      if (!isValidHex(c.hex)) errors.push(`Цвет ${code || '?'}: hex — в виде #RRGGBB`);
    }
  }
  const duplicateCodes = [...seen].filter(([, n]) => n > 1).map(([code]) => code);
  for (const code of duplicateCodes) errors.push(`Код цвета ${code} повторяется`);

  const owners = new Map<string, string[]>();
  for (const s of list) {
    for (const n of s.fabricSupplierNames) owners.set(n, [...(owners.get(n) ?? []), s.name]);
  }
  for (const [name, who] of owners) {
    if (who.length > 1) errors.push(`Ткани «${name}» привязаны к нескольким палитрам: ${who.join(', ')}`);
  }
  const unbound = fabricNames.filter((n) => !owners.has(n));
  return { errors, duplicateCodes, unbound };
}
