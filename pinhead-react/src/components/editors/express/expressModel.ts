/**
 * Экспресс-расчёт (веха 8, задача 4): данные и формула без React.
 *
 * Формула — прежняя (`ExpressCalc` до рестайла): изделие той же функцией, что визард
 * (`skuCost` → накладные → наценка по группе и тиражу), нанесение — сумма надбавок
 * активных зон (`calcZonePriceDirect`). Рестайл экрана сумм не меняет — это держит
 * `expressModel.test.ts` числами, снятыми со старого экрана.
 *
 * Бирок в экспрессе нет и не было (решение К9 плана вехи 8): цена бирок v4 —
 * `salesLabelPrice` по библиотеке, отдельной копии здесь не заводим.
 */
import { calcZonePriceDirect, getMarkup, getPrices } from '../../../utils/pricing';
import { skuCost, garmentSellPrice, overheadOf, ceilToStep, UNIT_PRICE_STEP } from '../../../utils/costRules';
import type { ExtraItem, Fabric, SkuItem, Trim } from '../../../types/catalog';

export type Tech = 'screen' | 'flex' | 'dtf' | 'dtg' | 'embroidery';

export interface ZoneEntry {
  active: boolean;
  tech: Tech;
  fmt: string;
  col: number;
  textile: string;
  fx: string;
}

export type ZoneData = Record<string, ZoneEntry>;

export interface Option<V extends string | number = string> {
  value: V;
  label: string;
}

export const TECH_OPTIONS: Option<Tech>[] = [
  { value: 'screen', label: 'Шелкография' },
  { value: 'flex', label: 'Flex' },
  { value: 'dtf', label: 'DTF' },
  { value: 'dtg', label: 'DTG' },
  { value: 'embroidery', label: 'Вышивка' },
];

export const SCREEN_FORMATS = ['A4', 'A3', 'A3+', 'Max'];
export const SCREEN_MAX_COLORS = 8;
export const DTF_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
export const DTG_FORMATS = ['A6', 'A5', 'A4', 'A3', 'A3+'];
export const EMB_AREAS: Option[] = [
  { value: 's', label: 'до 7 см' },
  { value: 'm', label: 'до 12 см' },
  { value: 'l', label: 'до 20 см' },
];
export const EMB_MAX_THREADS = 5;
export const TEXTILES: Option[] = [
  { value: 'white', label: 'Белый' },
  { value: 'color', label: 'Цветной ×1,3' },
];

/** Зоны модели без своего списка — как в визарде */
export const DEFAULT_GARMENT_ZONES = ['front', 'back', 'sleeve-l', 'sleeve-r'];

/** Варианты-строки как опции кнопок: значение и подпись совпадают */
export const asOptions = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: v }));

/** 1…n как опции «Цвета»/«Нити» */
export const countOptions = (n: number): Option<number>[] =>
  Array.from({ length: n }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

export function makeDefaultZoneEntry(active: boolean): ZoneEntry {
  return { active, tech: 'screen', fmt: 'A4', col: 1, textile: 'white', fx: 'none' };
}

export function zonesOf(sku: SkuItem | null): string[] {
  if (!sku) return [];
  return sku.zones && sku.zones.length > 0 ? sku.zones : DEFAULT_GARMENT_ZONES;
}

/** Новая модель — первая зона включена, остальные выключены */
export function initZoneData(zones: readonly string[]): ZoneData {
  const data: ZoneData = {};
  zones.forEach((id, i) => { data[id] = makeDefaultZoneEntry(i === 0); });
  return data;
}

/** Включить/выключить зону; последнюю включённую не выключаем — нанесение хотя бы одно */
export function toggleZone(data: ZoneData, id: string): ZoneData {
  const cur = data[id] || makeDefaultZoneEntry(false);
  if (cur.active && activeCount(data) <= 1) return data;
  return { ...data, [id]: { ...cur, active: !cur.active } };
}

export function activeCount(data: ZoneData): number {
  return Object.values(data).filter((d) => d.active).length;
}

/** Смена техники сбрасывает параметры к умолчанию техники */
export function withTech(entry: ZoneEntry | undefined, tech: Tech): ZoneEntry {
  const d = { ...(entry || makeDefaultZoneEntry(true)), tech, col: 1 };
  if (tech === 'embroidery') return { ...d, fmt: 's' };
  if (tech === 'screen') return { ...d, fmt: 'A4', textile: 'white', fx: 'none' };
  return { ...d, fmt: 'A4' };
}

/** Надбавка зоны, ₽/шт. Ткань — для ×1,5 шелкографии по футеру, как в визарде */
export function zoneSurcharge(d: ZoneEntry | undefined, qty: number, fabricCode?: string | null): number {
  if (!d || !d.active) return 0;
  return calcZonePriceDirect(d.tech, d, qty, fabricCode || undefined);
}

export interface QuoteInput {
  sku: SkuItem;
  fabric: Fabric | null;
  qty: number;
  zones: ZoneData;
  extras: string[];
  fabricsCatalog: Fabric[];
  trimCatalog: Trim[];
  extrasCatalog: ExtraItem[];
  usdRate: number;
}

export interface Quote {
  baseRaw: number;
  base: number;
  markupPct: number;
  overheadPct: number;
  extrasCost: number;
  techTotal: number;
  zoneCount: number;
  /** Изделие + нанесения до округления — суммы старого экрана */
  unitRaw: number;
  /** Цена за штуку ВВЕРХ до 5 ₽, как на рабочем месте (обход, M-3) */
  unitPrice: number;
  total: number;
}

export function quote(input: QuoteInput): Quote {
  const { sku, fabric, qty, zones } = input;
  const P = getPrices();
  const c = skuCost(sku, {
    fabricCode: fabric?.code || null,
    fabricsCatalog: input.fabricsCatalog,
    trimCatalog: input.trimCatalog,
    usdRate: input.usdRate,
    extras: input.extras,
    extrasCatalog: input.extrasCatalog,
  });
  const markupPct = getMarkup(qty, sku.category || 'tshirts', sku);
  const base = Math.round(garmentSellPrice(P, c.base, markupPct, 0));
  const active = Object.values(zones).filter((d) => d.active);
  const techTotal = active.reduce((sum, d) => sum + zoneSurcharge(d, qty, fabric?.code), 0);
  const unitRaw = base + techTotal;
  const unitPrice = ceilToStep(unitRaw, UNIT_PRICE_STEP);
  return {
    baseRaw: Math.round(c.base),
    base,
    markupPct,
    overheadPct: overheadOf(P),
    extrasCost: c.extras,
    techTotal,
    zoneCount: active.length,
    unitRaw,
    unitPrice,
    total: unitPrice * qty,
  };
}

/** Рубли для показа: разряды пробелом, дробь — как раньше (`toLocaleString('ru-RU')`) */
export const rub = (v: number): string => `${v.toLocaleString('ru-RU')} ₽`;
