/**
 * Визард Order Studio ↔ позиция Order v4.
 *
 * Шаги визарда «Изделие» и «Дизайн» работают в карточке v4 как есть (см.
 * `itemSession.ts`): на выходе у них снимок позиции визарда (`snapshotItem`,
 * поля `ITEM_FIELDS`), здесь он становится `SalesItem`, и обратно — для
 * «Изменить в визарде».
 *
 * Карточка v4 знает больше визарда: Pantone, группу размеров нанесения,
 * отступ, «на крое/готовом», ТЗ пошива, бирки поштучно, несколько цветов
 * в сетке. Поэтому перевод из визарда НАКЛАДЫВАЕТСЯ на прежнюю позицию
 * (`base`), а не заменяет её: визард правит то, что умеет, остальное остаётся.
 */
import { findColorEntry } from '../../data/colors';
import { initSizes, sizeOrder } from '../../store/slices/helpers';
import { FMT_SIZES } from '../../utils/pricingCore';
import { fitFormat } from '../pricing/priceOrder';
import { newSalesItem, newSalesLabel, newSalesPrint } from '../model/factory';
import type { SalesItem, SalesLabel, SalesPrint, SalesPrintMethod } from '../model/types';
import type { Fabric, SkuItem, ZoneDefinition } from '../../types/catalog';

/* eslint-disable @typescript-eslint/no-explicit-any -- снимок визарда нетипизирован (см. types/order.ts: типы техник устарели) */
export type WizardItem = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface WizardCatalogs {
  skuCatalog: SkuItem[];
  fabricsCatalog: Fabric[];
  zonesCatalog: ZoneDefinition[];
}

type WizardTech = 'screen' | 'flex' | 'dtg' | 'embroidery' | 'dtf';

const TECH_TO_METHOD: Record<WizardTech, SalesPrintMethod> = {
  screen: 'silkscreen',
  flex: 'heat_transfer',
  dtg: 'dtg',
  embroidery: 'embroidery',
  dtf: 'dtf',
};

const METHOD_TO_TECH: Partial<Record<SalesPrintMethod, WizardTech>> = {
  silkscreen: 'screen',
  heat_transfer: 'flex',
  dtg: 'dtg',
  embroidery: 'embroidery',
  dtf: 'dtf',
};

/** Поле параметров техники в сторе визарда */
const TECH_FIELD: Record<WizardTech, string> = {
  screen: 'zonePrints',
  flex: 'flexZones',
  dtg: 'dtgZones',
  embroidery: 'embZones',
  dtf: 'dtfZones',
};

// ── Цвет ──────────────────────────────────────────────────────────────────

/** Цвет визарда (код палитры) → подпись строки сетки: «Чёрный (15-01)» */
export function colorLabel(code: string): string {
  if (!code) return '';
  const entry = findColorEntry(code);
  return entry ? `${entry.name} (${code})` : code;
}

/** Обратно: код палитры из подписи строки; не распознан — пусто */
export function colorCodeOf(label: string): string {
  const m = label.match(/\(([^()]+)\)\s*$/);
  if (m && findColorEntry(m[1])) return m[1];
  return findColorEntry(label.trim()) ? label.trim() : '';
}

// ── Зона ──────────────────────────────────────────────────────────────────

function zoneName(id: string, zones: ZoneDefinition[]): string {
  return zones.find((z) => z.id === id)?.name ?? id;
}

function zoneId(name: string, zones: ZoneDefinition[]): string {
  return zones.find((z) => z.name === name || z.id === name)?.id ?? name;
}

const fmtMm = (fmt: string | undefined) => FMT_SIZES[fmt || 'A4'] ?? FMT_SIZES.A4;

// ── Визард → v4 ──────────────────────────────────────────────────────────

function printFromZone(snap: WizardItem, id: string, cat: WizardCatalogs, base: SalesPrint | undefined): SalesPrint {
  const tech = (snap.zoneTechs?.[id] || 'screen') as WizardTech;
  const p = snap[TECH_FIELD[tech]]?.[id] ?? {};
  const patch: Partial<SalesPrint> = {
    method: TECH_TO_METHOD[tech] ?? 'silkscreen',
    zone: zoneName(id, cat.zonesCatalog),
  };
  if (tech === 'screen' || tech === 'flex' || tech === 'dtg') {
    const { w, h } = fmtMm(p.size);
    patch.width_mm = w;
    patch.height_mm = h;
  }
  if (tech === 'screen' || tech === 'flex') patch.colors = Math.max(1, parseInt(p.colors) || 1);
  if (tech === 'screen' || tech === 'dtg') patch.textile = p.textile === 'color' ? 'color' : 'white';
  if (tech === 'screen') patch.special = p.fx && p.fx !== 'none' ? p.fx : '';
  if (tech === 'embroidery') {
    patch.width_mm = Number(p.width_mm) || 50;
    patch.height_mm = Number(p.height_mm) || 50;
    patch.fill = Number(p.fill) || 1;
    patch.special = p.extra || '';
  }
  if (tech === 'dtf') {
    const { w, h } = fmtMm(p.fmt || p.size);
    patch.width_mm = Number(p.width_mm) || w;
    patch.height_mm = Number(p.height_mm) || h;
  }
  const art = snap.zoneArtworks?.[id];
  if (art) patch.artwork_url = art;
  // Доработанное в карточке (Pantone, группа размеров, отступ, «где», комментарий) остаётся
  return base ? { ...base, ...patch } : newSalesPrint(patch);
}

function labelsFrom(snap: WizardItem, base: SalesLabel[]): SalesLabel[] {
  const cfg = snap.labelConfig;
  const out = [...base];
  const has = (type: string) => base.some((l) => l.label_type === type);
  const note = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(', ');
  if (cfg?.careLabel?.enabled && !has('composition')) {
    out.push(newSalesLabel({
      label_type: 'composition',
      comment: note(cfg.careLabel.composition, cfg.careLabel.country, cfg.careLabel.comments),
    }));
  }
  const main = cfg?.mainLabel;
  if (main && main.option !== 'none' && !has('brand')) {
    out.push(newSalesLabel({
      label_type: 'brand',
      place: main.placement === 'inseam' ? 'Боковой шов' : 'Горловина',
      comment: note(main.option === 'send-own' ? 'бирка клиента' : main.option, main.material, main.color, main.comments),
    }));
  }
  if (cfg?.hangTag && cfg.hangTag.option !== 'none' && !has('hangtag')) {
    out.push(newSalesLabel({ label_type: 'hangtag', comment: note(cfg.hangTag.option, cfg.hangTag.comments) }));
  }
  return out;
}

/** Размеры и количество визарда: стандартные без нулей + свои размеры */
function wizardQty(snap: WizardItem): Record<string, number> {
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

/**
 * Снимок визарда → позиция v4.
 * `base` — прежняя позиция при «Изменить в визарде»; `editRow` — подпись
 * строки сетки, которую правил визард (у визарда один цвет на позицию).
 */
export function wizardToSalesItem(
  snap: WizardItem, cat: WizardCatalogs, base?: SalesItem, editRow?: string,
): SalesItem {
  const item: SalesItem = base
    ? { ...base, prints: [...base.prints], labels: [...base.labels] }
    : newSalesItem({ kind: 'sku' });

  const sku = snap.sku as SkuItem | null;
  if (sku) {
    item.sku_code = sku.code;
    item.product_type = sku.name;
    item.fit = sku.fit || snap.fit || item.fit;
  }

  const fabric = cat.fabricsCatalog.find((f) => f.code === snap.fabric);
  item.fabric_code = snap.fabric || '';
  const color = colorLabel(snap.color || '');
  if (fabric) {
    item.main_fabric = [fabric.name, fabric.composition, fabric.density ? `${fabric.density} г/м²` : '']
      .filter(Boolean).join(', ');
    item.color_supplier = [color.replace(/\s*\([^)]*\)$/, ''), fabric.supplier].filter(Boolean).join(' / ');
  }

  // Сетка: строка цвета визарда заменяется, остальные строки остаются
  const qty = wizardQty(snap);
  const rows = base ? [...base.size_grid.rows] : [];
  const target = editRow ?? color;
  const idx = rows.findIndex((r) => r.color === target
    || (colorCodeOf(r.color) !== '' && colorCodeOf(r.color) === snap.color));
  const row = { color: color || target || '', sizes: qty };
  if (idx >= 0) rows[idx] = row;
  else if (Object.keys(qty).length > 0 || rows.length === 0) rows.push(row);
  const sizes = [...new Set([...(base?.size_grid.sizes ?? []), ...Object.keys(qty)])]
    .sort((a, b) => sizeOrder(a) - sizeOrder(b));
  item.size_grid = { sizes, rows };

  // Нанесения: по зонам визарда; техники, которых у визарда нет (сублимация,
  // шевроны), заведённые в карточке, остаются как есть
  const zones: string[] = snap.noPrint ? [] : (snap.zones ?? []);
  const byZone = new Map((base?.prints ?? []).map((p) => [p.zone, p]));
  const keep = (base?.prints ?? []).filter((p) => !METHOD_TO_TECH[p.method]);
  const fromWizard = zones.map((z) => printFromZone(snap, z, cat, byZone.get(zoneName(z, cat.zonesCatalog))));
  const notes = String(snap.designNotes ?? '').trim();
  if (notes && fromWizard[0] && !fromWizard[0].comment) fromWizard[0] = { ...fromWizard[0], comment: `Дизайн: ${notes}` };
  item.prints = [...fromWizard, ...keep];

  item.labels = labelsFrom(snap, base?.labels ?? []);
  item.extras = [...(snap.extras ?? [])];
  const sizeComment = String(snap.sizeComment ?? '').trim();
  if (sizeComment && !item.cutting_note) item.cutting_note = sizeComment;
  return item;
}

// ── v4 → визард ──────────────────────────────────────────────────────────

/**
 * Позиция v4 → поля визарда для «Изменить в визарде».
 * `rowColor` — какая строка сетки редактируется (по умолчанию первая).
 * `type` не возвращается: его ставит штатный `selectSku` визарда (сессия
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
  const zoneArtworks: Record<string, string> = {};
  for (const p of item.prints) {
    const tech = METHOD_TO_TECH[p.method];
    if (!tech) continue;
    const id = zoneId(p.zone, cat.zonesCatalog);
    zones.push(id);
    zoneTechs[id] = tech;
    const fmt = fitFormat(p.width_mm, p.height_mm).fmt;
    if (tech === 'screen') fields.zonePrints[id] = { colors: p.colors, size: fmt, textile: p.textile, fx: p.special || 'none' };
    if (tech === 'flex') fields.flexZones[id] = { colors: p.colors, size: fmt };
    if (tech === 'dtg') fields.dtgZones[id] = { size: fmt, textile: p.textile };
    if (tech === 'embroidery') fields.embZones[id] = { width_mm: p.width_mm ?? 50, height_mm: p.height_mm ?? 50, fill: p.fill, extra: p.special || null };
    if (tech === 'dtf') fields.dtfZones[id] = { fmt, width_mm: p.width_mm, height_mm: p.height_mm };
    if (p.artwork_url) zoneArtworks[id] = p.artwork_url;
  }

  return {
    sku,
    fit: item.fit || sku?.fit || 'regular',
    fitChosen: !!sku,
    fabric: item.fabric_code,
    color: colorCodeOf(row?.color ?? ''),
    sizes,
    customSizes,
    extras: [...item.extras],
    zones,
    zoneTechs,
    ...fields,
    zoneArtworks,
    noPrint: item.prints.length === 0,
  };
}
