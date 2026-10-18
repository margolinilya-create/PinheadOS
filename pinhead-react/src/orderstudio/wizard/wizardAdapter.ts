/**
 * Позиция Order v4 ↔ поля стора визарда (буфер позиции рабочего места, веха 3).
 *
 * - `salesItemToWizard` — позиция → поля визарда: панели вкладки «Изделие»
 *   (`GarmentPanel`) работают на сторе визарда, `itemBuffer` грузит в него позицию;
 * - `garmentPatch` — разница буфера → новая позиция (пишется только изменённое).
 *
 * Обратный перенос «снимок визарда → позиция» (`wizardToSalesItem`) убран в вехе 5а:
 * визарда v3 как экрана нет с вехи 3, читателей у переноса не осталось.
 * Техники визарда ↔ Order — `model/printMethods`.
 */
import { findPaletteColor, supplierForFabric } from '../catalog/suppliers';
import type { Supplier } from '../catalog/types';
import { initSizes, sizeOrder } from '../../store/slices/helpers';
import { dtgFitSize } from '../../utils/printRules';
import { embroideryExtras, fitFormat, screenFormat } from '../pricing/priceOrder';
import { METHOD_TO_TECH, type WizardTech } from '../model/printMethods';
import type { SalesItem } from '../model/types';
import { retextilePrints, textileOfColor } from '../model/garmentTextile';
import type { Fabric, SkuItem, ZoneDefinition } from '../../types/catalog';

/* eslint-disable @typescript-eslint/no-explicit-any -- снимок визарда нетипизирован (см. types/order.ts: типы техник устарели) */
export type WizardItem = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface WizardCatalogs {
  skuCatalog: SkuItem[];
  fabricsCatalog: Fabric[];
  zonesCatalog: ZoneDefinition[];
  /** Поставщики и палитры (`catalog_config.suppliers`) — подписи и коды цветов */
  suppliers: Supplier[];
}

// ── Цвет ──────────────────────────────────────────────────────────────────

/**
 * Цвет визарда → подпись строки сетки: код палитры — «Чёрный (15-01)»,
 * свободный текст («розовый») — как есть. Палитры — аргументом; `preferred` —
 * палитра поставщика ткани (ищется первой), затем все палитры, снятые тоже.
 */
export function colorLabel(code: string, suppliers: readonly Supplier[], preferred?: Supplier | null): string {
  if (!code) return '';
  const entry = findPaletteColor(code, suppliers, preferred);
  return entry ? `${entry.name} (${entry.code})` : code;
}

/** Обратно: код палитры из подписи строки; не распознан — пусто */
export function colorCodeOf(label: string, suppliers: readonly Supplier[], preferred?: Supplier | null): string {
  const m = label.match(/\(([^()]+)\)\s*$/);
  if (m && findPaletteColor(m[1], suppliers, preferred)) return m[1];
  const bare = label.trim();
  return findPaletteColor(bare, suppliers, preferred) ? bare : '';
}

/** Палитра ткани по коду из каталога; ткани нет — `null` */
function paletteOfFabric(code: string, cat: WizardCatalogs): Supplier | null {
  return supplierForFabric(cat.fabricsCatalog.find((f) => f.code === code), cat.suppliers);
}

// ── Зона ──────────────────────────────────────────────────────────────────

function zoneId(name: string, zones: ZoneDefinition[]): string {
  return zones.find((z) => z.name === name || z.id === name)?.id ?? name;
}

/** DTG-размер `40x45` у визарда — кнопка A3+ */
const DTG_KEY_TO_WIZARD: Record<string, string> = { '40x45': 'A3+' };

/**
 * Мм v4 → формат визарда ПО ТЕХНИКЕ: у каждой техники свои размеры
 * (DTG A4 — 200×300, а не лист 210×297; Max у шелкографии — свой предел).
 */
function fmtOf(tech: WizardTech, w: number | null, h: number | null): string {
  if (tech === 'dtg') {
    const k = dtgFitSize(w, h);
    return k ? (DTG_KEY_TO_WIZARD[k] ?? k) : (w && h ? 'A3+' : 'A4');
  }
  if (tech === 'screen') return screenFormat(w, h).fmt;
  return fitFormat(w, h).fmt;
}

/** Ткань для ТЗ: «Кулирка, 100% хб, 180 г/м²» */
function fabricText(fabric: Fabric): string {
  return [fabric.name, fabric.composition, fabric.density ? `${fabric.density} г/м²` : '']
    .filter(Boolean).join(', ');
}

/**
 * «Цвет / поставщик»: имя цвета без кода палитры и поставщик ткани. Скобки
 * срезаются, только если в них РАСПОЗНАННЫЙ код: «Хаки (светлый)» — свой цвет,
 * он остаётся целиком.
 */
function colorSupplierText(colorRowLabel: string, fabric: Fabric, suppliers: readonly Supplier[]): string {
  const m = colorRowLabel.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const name = m && findPaletteColor(m[2], suppliers) ? m[1] : colorRowLabel;
  return [name, fabric.supplier].filter(Boolean).join(' / ');
}

/** Размеры и количество визарда: стандартные без нулей + свои размеры */
function wizardQty(snap: { sizes?: Record<string, unknown>; customSizes?: { label: string; qty: unknown }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [size, q] of Object.entries(snap.sizes ?? {})) {
    const n = parseInt(String(q)) || 0;
    if (n > 0) out[size] = n;
  }
  for (const c of snap.customSizes ?? []) {
    const n = parseInt(String(c.qty)) || 0;
    if (c.label && n > 0) out[c.label] = (out[c.label] ?? 0) + n;
  }
  return out;
}

// ── v4 → визард ──────────────────────────────────────────────────────────

/**
 * Позиция v4 → поля визарда для буфера позиции (`itemBuffer`).
 * `rowColor` — какая строка сетки редактируется (по умолчанию первая).
 * `type` не возвращается: его ставит штатный `selectSku` визарда (буфер
 * вызывает его по `sku`), иначе тип разошёлся бы с тем, что ставит визард.
 */
export function salesItemToWizard(item: SalesItem, cat: WizardCatalogs, rowColor?: string): WizardItem {
  const sku = cat.skuCatalog.find((s) => s.code === item.sku_code) ?? null;
  const row = item.size_grid.rows.find((r) => r.color === rowColor) ?? item.size_grid.rows[0];
  // Размеры визарда — его штатный набор; чего в нём нет, уходит в «свои размеры»
  const sizes: Record<string, number> = initSizes();
  const customSizes: { label: string; qty: number }[] = [];
  for (const [size, q] of Object.entries(row?.sizes ?? {})) {
    const n = Number(q) || 0;
    if (size in sizes) sizes[size] = n;
    else if (n > 0) customSizes.push({ label: size, qty: n });
  }

  const zones: string[] = [];
  const zoneTechs: Record<string, string> = {};
  const fields: Record<string, Record<string, unknown>> = {
    zonePrints: {}, flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
  };
  for (const p of item.prints) {
    const tech = METHOD_TO_TECH[p.method];
    if (!tech) continue;
    const id = zoneId(p.zone, cat.zonesCatalog);
    zones.push(id);
    zoneTechs[id] = tech;
    const fmt = fmtOf(tech, p.width_mm, p.height_mm);
    if (tech === 'screen') fields.zonePrints[id] = { colors: p.colors, size: fmt, textile: p.textile, fx: p.special || 'none' };
    if (tech === 'flex') fields.flexZones[id] = { colors: p.colors, size: fmt };
    if (tech === 'dtg') fields.dtgZones[id] = { size: fmt, textile: p.textile };
    if (tech === 'embroidery') {
      const fx = embroideryExtras(p.special);
      const mode = /шеврон|нашивк|patch/i.test(p.garment_kind || '') ? 'patch' : p.on === 'cut' ? 'cut' : 'garment';
      fields.embZones[id] = {
        width_mm: p.width_mm ?? 50, height_mm: p.height_mm ?? 50, fill: p.fill,
        extra: fx[0] ?? null, extras: fx.slice(1), mode,
      };
    }
    if (tech === 'dtf') fields.dtfZones[id] = { fmt, width_mm: p.width_mm, height_mm: p.height_mm };
  }

  return {
    sku,
    fit: item.fit || sku?.fit || 'regular',
    fitChosen: !!sku,
    fabric: item.fabric_code,
    // Код палитры; свой цвет («розовый») — в буфер как есть, иначе он пропадал бы
    color: colorCodeOf(row?.color ?? '', cat.suppliers, paletteOfFabric(item.fabric_code, cat)) || (row?.color ?? ''),
    sizes,
    customSizes,
    extras: [...item.extras],
    zones,
    zoneTechs,
    ...fields,
    noPrint: item.prints.length === 0,
  };
}

// ── Буфер рабочего места → позиция (веха 3) ──────────────────────────────

/**
 * Поля «Изделия» из стора визарда, которые панели рабочего места пишут
 * в позицию. Выборка — `selectGarment` в `workplace/itemBuffer.ts`.
 */
export interface GarmentSnap {
  sku: SkuItem | null;
  fabric: string;
  color: string;
  colorSupplier: string;
  sizes: Record<string, number | string>;
  customSizes: { label: string; qty: number | string }[];
  extras: string[];
  fit: string;
  /** Ткань клиента (поле позиции v4, у визарда его нет) */
  clientFabric: boolean;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Размеры строки сетки равны — без учёта порядка ключей */
function sameQty(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * Разница буфера `prev → next` → новая позиция; менять нечего — `null`.
 *
 * Пишется ТОЛЬКО то, что изменилось, и только непустым значением: модель
 * или ткань не из каталога (буфер их не знает и держит пустыми), свой цвет
 * текстом (буфер держит его как есть, `colorLabel` возвращает его же) и ручной
 * текст `main_fabric`/`color_supplier` переживают правку размеров. Поэтому
 * загрузка позиции и перезагрузка каталогов ничего не пишут.
 *
 * Позиция с несколькими строками сетки буфером не правится (один цвет —
 * одна позиция): `null`. Нанесения и бирки — из `base` по ссылке; при смене
 * цвета нанесения с подложкой прежнего умолчания переходят на новое
 * (`retextilePrints`, обход H-2), прочие поля нанесений не трогаются.
 */
export function garmentPatch(prev: GarmentSnap, next: GarmentSnap, base: SalesItem, cat: WizardCatalogs): SalesItem | null {
  const rows = base.size_grid.rows;
  if (rows.length > 1) return null;
  const clientFabric = base.client_fabric || next.clientFabric;
  const fabricOf = (code: string) => cat.fabricsCatalog.find((f) => f.code === code);
  const patch: Partial<SalesItem> = {};
  let rowColor = rows[0]?.color ?? '';
  let rowSizes = rows[0]?.sizes ?? {};

  if (next.sku && prev.sku?.code !== next.sku.code) {
    patch.sku_code = next.sku.code;
    patch.product_type = next.sku.name;
    patch.fit = next.sku.fit || next.fit || base.fit;
  } else if (next.fit && prev.fit !== next.fit) {
    patch.fit = next.fit;
  }

  if (next.color && prev.color !== next.color) {
    rowColor = colorLabel(next.color, cat.suppliers, paletteOfFabric(next.fabric || base.fabric_code, cat));
  }
  if (!same(prev.sizes, next.sizes) || !same(prev.customSizes, next.customSizes)) rowSizes = wizardQty(next);

  const fabricChanged = !!next.fabric && prev.fabric !== next.fabric;
  if (!clientFabric && fabricChanged) patch.fabric_code = next.fabric;
  // Цвет и поставщик пересобираются при смене ткани или цвета — и только по ткани из каталога
  const fabric = clientFabric ? undefined : fabricOf(next.fabric || base.fabric_code);
  if (fabric && fabricChanged) patch.main_fabric = fabricText(fabric);
  if (fabric && (fabricChanged || rowColor !== (rows[0]?.color ?? ''))) {
    patch.color_supplier = colorSupplierText(rowColor, fabric, cat.suppliers);
  }

  if (rowColor !== (rows[0]?.color ?? '') || !sameQty(rowSizes, rows[0]?.sizes ?? {})) {
    const sizes = [...new Set([...base.size_grid.sizes, ...Object.keys(rowSizes)])]
      .sort((a, b) => sizeOrder(a) - sizeOrder(b));
    patch.size_grid = { sizes, rows: [{ color: rowColor, sizes: rowSizes }] };
  }
  if (!same(prev.extras, next.extras)) patch.extras = [...next.extras];
  // Сменился цвет — подложка нанесений вслед за ним, кроме выбранной руками (обход, H-2)
  const prevColor = rows[0]?.color ?? '';
  if (rowColor !== prevColor) {
    const fabricCode = patch.fabric_code ?? base.fabric_code;
    patch.prints = retextilePrints(base.prints, textileOfColor(prevColor, cat, fabricCode), textileOfColor(rowColor, cat, fabricCode));
  }

  const changed = (Object.keys(patch) as (keyof SalesItem)[]).filter((k) => !same(patch[k], base[k]));
  if (changed.length === 0) return null;
  return { ...base, ...Object.fromEntries(changed.map((k) => [k, patch[k]])) };
}
