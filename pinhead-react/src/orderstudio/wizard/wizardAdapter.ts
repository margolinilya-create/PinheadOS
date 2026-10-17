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
import { DTG_SIZES, dtgFitSize, dtgSizeKey } from '../../utils/printRules';
import { SCREEN_MAX_MM, embroideryExtras, fitFormat, screenFormat } from '../pricing/priceOrder';
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

/**
 * Формат визарда ↔ мм v4 — ПО ТЕХНИКЕ. Один перевод через размеры листа
 * ломал цену при переносе: DTG A4 (лист 210×297) не входил в DTG-размер
 * A4 (200×300) и считался как A3; Max у шелкографии мм не имел и становился
 * A4. Здесь у каждой техники свои размеры, и обратный перевод даёт тот же
 * формат (`fmtOf(mmOf(f)) === f`).
 */
type Mm = { w: number; h: number };

function mmOf(tech: WizardTech, fmt: string | undefined): Mm {
  const f = fmt || 'A4';
  if (tech === 'dtg') {
    const s = DTG_SIZES.find((d) => d.key === dtgSizeKey(f)) ?? DTG_SIZES.find((d) => d.key === 'A4')!;
    return { w: s.w, h: s.h };
  }
  if (tech === 'screen' && f === 'Max') return SCREEN_MAX_MM;
  return FMT_SIZES[f] ?? FMT_SIZES.A4;
}

/** DTG-размер `40x45` у визарда — кнопка A3+ */
const DTG_KEY_TO_WIZARD: Record<string, string> = { '40x45': 'A3+' };

function fmtOf(tech: WizardTech, w: number | null, h: number | null): string {
  if (tech === 'dtg') {
    const k = dtgFitSize(w, h);
    return k ? (DTG_KEY_TO_WIZARD[k] ?? k) : (w && h ? 'A3+' : 'A4');
  }
  if (tech === 'screen') return screenFormat(w, h).fmt;
  return fitFormat(w, h).fmt;
}

/** Способ вышивки визарда ↔ «где наносим» и тип изделия v4 */
const PATCH_KIND = 'Шеврон';

// ── Визард → v4 ──────────────────────────────────────────────────────────

function printFromZone(snap: WizardItem, id: string, cat: WizardCatalogs, base: SalesPrint | undefined): SalesPrint {
  const tech = (snap.zoneTechs?.[id] || 'screen') as WizardTech;
  const p = snap[TECH_FIELD[tech]]?.[id] ?? {};
  const patch: Partial<SalesPrint> = {
    method: TECH_TO_METHOD[tech] ?? 'silkscreen',
    zone: zoneName(id, cat.zonesCatalog),
  };
  if (tech === 'screen' || tech === 'flex' || tech === 'dtg') {
    // Мм, заданные в карточке, остаются, пока формат в визарде не меняли:
    // иначе проход «Изменить в визарде» без правок сбивал 250×300 до листа A3
    const keepMm = base && METHOD_TO_TECH[base.method] === tech
      && fmtOf(tech, base.width_mm, base.height_mm) === (p.size || 'A4');
    if (!keepMm) {
      const { w, h } = mmOf(tech, p.size);
      patch.width_mm = w;
      patch.height_mm = h;
    }
  }
  if (tech === 'screen' || tech === 'flex') patch.colors = Math.max(1, parseInt(p.colors) || 1);
  if (tech === 'screen' || tech === 'dtg') patch.textile = p.textile === 'color' ? 'color' : 'white';
  if (tech === 'screen') patch.special = p.fx && p.fx !== 'none' ? p.fx : '';
  if (tech === 'embroidery') {
    patch.width_mm = Number(p.width_mm) || 50;
    patch.height_mm = Number(p.height_mm) || 50;
    patch.fill = Number(p.fill) || 1;
    // Надбавки суммируются: одна из списка `extras` плюс выбор `extra`
    const fx = [...new Set([...(p.extras ?? []), ...(p.extra ? [p.extra] : [])])];
    patch.special = embroideryExtras(fx.join('+')).join('+');
    if (p.mode === 'patch') patch.garment_kind = PATCH_KIND;
    else {
      patch.on = p.mode === 'garment' ? 'finished' : 'cut';
      if (base?.garment_kind === PATCH_KIND) patch.garment_kind = '';
    }
  }
  if (tech === 'dtf') {
    const { w, h } = mmOf('dtf', p.fmt || p.size);
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
      // Вариант — для цены (`salesLabelPrice`): та же ставка, что в визарде
      variant_id: cfg.careLabel.logoOption || 'standard',
      comment: note(cfg.careLabel.composition, cfg.careLabel.country, cfg.careLabel.comments),
    }));
  }
  const main = cfg?.mainLabel;
  if (main && main.option !== 'none' && !has('brand')) {
    out.push(newSalesLabel({
      label_type: 'brand',
      variant_id: [main.option, main.material].filter(Boolean).join(':'),
      place: main.placement === 'inseam' ? 'Боковой шов' : 'Горловина',
      comment: note(main.option === 'send-own' ? 'бирка клиента' : main.option, main.material, main.color, main.comments),
    }));
  }
  if (cfg?.hangTag && cfg.hangTag.option !== 'none' && !has('hangtag')) {
    out.push(newSalesLabel({ label_type: 'hangtag', variant_id: cfg.hangTag.option, comment: note(cfg.hangTag.option, cfg.hangTag.comments) }));
  }
  return out;
}

/** Ткань для ТЗ: «Кулирка, 100% хб, 180 г/м²» */
function fabricText(fabric: Fabric): string {
  return [fabric.name, fabric.composition, fabric.density ? `${fabric.density} г/м²` : '']
    .filter(Boolean).join(', ');
}

/** «Цвет / поставщик»: имя цвета без кода палитры и поставщик ткани */
function colorSupplierText(colorRowLabel: string, fabric: Fabric): string {
  return [colorRowLabel.replace(/\s*\([^)]*\)$/, ''), fabric.supplier].filter(Boolean).join(' / ');
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
    item.main_fabric = fabricText(fabric);
    item.color_supplier = colorSupplierText(color, fabric);
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
 * Пишется ТОЛЬКО то, что изменилось, и только непустым значением: модель,
 * цвет или ткань не из каталога (буфер их не знает и держит пустыми) и ручной
 * текст `main_fabric`/`color_supplier` переживают правку размеров. Поэтому
 * загрузка позиции и перезагрузка каталогов ничего не пишут.
 *
 * Позиция с несколькими строками сетки буфером не правится (один цвет —
 * одна позиция): `null`. Нанесения и бирки — из `base` по ссылке.
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

  if (next.color && prev.color !== next.color) rowColor = colorLabel(next.color);
  if (!same(prev.sizes, next.sizes) || !same(prev.customSizes, next.customSizes)) rowSizes = wizardQty(next);

  const fabricChanged = !!next.fabric && prev.fabric !== next.fabric;
  if (!clientFabric && fabricChanged) patch.fabric_code = next.fabric;
  // Цвет и поставщик пересобираются при смене ткани или цвета — и только по ткани из каталога
  const fabric = clientFabric ? undefined : fabricOf(next.fabric || base.fabric_code);
  if (fabric && fabricChanged) patch.main_fabric = fabricText(fabric);
  if (fabric && (fabricChanged || rowColor !== (rows[0]?.color ?? ''))) {
    patch.color_supplier = colorSupplierText(rowColor, fabric);
  }

  if (rowColor !== (rows[0]?.color ?? '') || !sameQty(rowSizes, rows[0]?.sizes ?? {})) {
    const sizes = [...new Set([...base.size_grid.sizes, ...Object.keys(rowSizes)])]
      .sort((a, b) => sizeOrder(a) - sizeOrder(b));
    patch.size_grid = { sizes, rows: [{ color: rowColor, sizes: rowSizes }] };
  }
  if (!same(prev.extras, next.extras)) patch.extras = [...next.extras];

  const changed = (Object.keys(patch) as (keyof SalesItem)[]).filter((k) => !same(patch[k], base[k]));
  if (changed.length === 0) return null;
  return { ...base, ...Object.fromEntries(changed.map((k) => [k, patch[k]])) };
}
