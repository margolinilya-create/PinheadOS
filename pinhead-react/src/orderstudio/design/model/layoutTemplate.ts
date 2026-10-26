/**
 * Данные «Моей раскладки» (веха 5в, Э8) — форма строки `order_templates.data`
 * и её строгий разбор. В раскладке — только место, ширина и техника: цвета,
 * Pantone и эффект — свойства логотипа, а не места (их в ТЗ чужому логотипу
 * не переносим). Без геометрии и без React: её читает и API
 * (`api/layoutTemplates.ts`), и панель (`ui/panel/templateOps.ts`).
 */
import type { SalesPrintMethod } from '../../model/types';
import { SALES_PRINT_METHODS } from '../../model/types';
import { DESIGN_VIEWS, type DesignView } from '../types';

export const MAX_TEMPLATE_PRINTS = 20;

export interface TemplatePrint {
  view: DesignView;
  area_id: string;
  zone_id: string | null;
  method: SalesPrintMethod;
  /** Ширина видимой рамки (с поворотом), мм */
  width_mm: number;
  /** Отступ по вертикали от опоры вида (горловина, верх зоны, низ рукава), мм */
  down_mm: number;
  /** Смещение центра от оси, мм; плюс — вправо на рисунке */
  dx_mm: number;
  rotation_deg: number;
}

export interface LayoutTemplateData {
  kind: 'layout';
  v: 1;
  /** Силуэт, с которого снята (справочно: применяется по зонам) */
  flat_id: string;
  prints: TemplatePrint[];
}

/* Разбор: данные из базы — недоверенные */
const MAX_TEXT = 64;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;

function parsePrint(raw: unknown): TemplatePrint | null {
  if (!isObj(raw)) return null;
  const { view, area_id, zone_id, method } = raw;
  if (!DESIGN_VIEWS.includes(view as DesignView)) return null;
  if (!text(area_id) || !area_id || !(zone_id === null || (text(zone_id) && zone_id))) return null;
  if (!SALES_PRINT_METHODS.includes(method as SalesPrintMethod)) return null;
  if (!num(raw.width_mm, 1, 1000) || !num(raw.down_mm, -1000, 1000) || !num(raw.dx_mm, -1000, 1000)) return null;
  if (!num(raw.rotation_deg, 0, 359.9)) return null;
  return {
    view: view as DesignView, area_id, zone_id: zone_id as string | null, method: method as SalesPrintMethod,
    width_mm: raw.width_mm, down_mm: raw.down_mm, dx_mm: raw.dx_mm, rotation_deg: raw.rotation_deg,
  };
}

/** Строгий разбор: что-то не так — `null` (строка списка пропускается) */
export function parseLayoutTemplate(raw: unknown): LayoutTemplateData | null {
  if (!isObj(raw) || raw.kind !== 'layout' || raw.v !== 1 || !text(raw.flat_id)) return null;
  const list = raw.prints;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_TEMPLATE_PRINTS) return null;
  const prints = list.map(parsePrint);
  if (prints.some((p) => p === null)) return null;
  return { kind: 'layout', v: 1, flat_id: raw.flat_id, prints: prints as TemplatePrint[] };
}
