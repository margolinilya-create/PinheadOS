/**
 * Подложка нанесения по цвету изделия (находка обхода H-2, веха 8).
 *
 * Шелкография и DTG по цветному текстилю дороже (подложка), а новое
 * нанесение раньше всегда получало `textile: 'white'` — на чёрной футболке
 * цена выходила ниже, если продавец сам не переключал «Изделие». Теперь
 * умолчание берётся из цвета позиции: светлый цвет палитры — «Белое / светлое»,
 * остальные — «Цветное (подложка)». Выбор в строке нанесения остаётся за
 * человеком; при смене цвета изделия переключаются только нанесения, чья
 * подложка совпадала с умолчанием прежнего цвета (`retextilePrints`).
 */
import { findPaletteColor, supplierForFabric, type FabricLike } from '../catalog/suppliers';
import type { Supplier } from '../catalog/types';
import type { SalesItem, SalesPrint } from './types';

export type Textile = SalesPrint['textile'];

export interface TextileCatalogs {
  suppliers: readonly Supplier[];
  fabricsCatalog: readonly (FabricLike & { code?: string })[];
}

/**
 * Порог относительной яркости (WCAG, 0…1), с которого цвет — «светлое»
 * изделие без подложки. Молочный, айвори, белый — выше; светло-серый
 * (#D3D3D3 ≈ 0,65) и меланж — ниже: лучше цена с подложкой, чем заниженная.
 */
const LIGHT_MIN_LUMINANCE = 0.7;

/** Методы, у которых подложка входит в цену (`priceOrder.printUnitPrice`) */
const TEXTILE_METHODS: readonly SalesPrint['method'][] = ['silkscreen', 'dtg'];

function luminance(hex: string): number | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Код палитры из подписи строки сетки «Чёрный (40-01)» или голый код */
function paletteHex(label: string, cat: TextileCatalogs, fabricCode: string): string | null {
  const fabric = cat.fabricsCatalog.find((f) => f.code === fabricCode);
  const preferred = supplierForFabric(fabric, cat.suppliers);
  const code = /\(([^()]+)\)\s*$/.exec(label)?.[1] ?? label.trim();
  return findPaletteColor(code, cat.suppliers, preferred)?.hex ?? null;
}

/**
 * Подложка по подписи цвета. Цвета нет — «белое» (прежнее умолчание: позиция
 * ещё не собрана); свой текст вне палитры — «белое» только по слову «белый».
 */
export function textileOfColor(label: string, cat: TextileCatalogs, fabricCode: string): Textile {
  const text = (label ?? '').trim();
  if (!text) return 'white';
  const hex = paletteHex(text, cat, fabricCode);
  const lum = hex ? luminance(hex) : null;
  if (lum === null) return /^бел|^white/i.test(text) ? 'white' : 'color';
  return lum >= LIGHT_MIN_LUMINANCE ? 'white' : 'color';
}

/** Подложка нового нанесения позиции — по первой строке сетки */
export function textileOfItem(item: Pick<SalesItem, 'size_grid' | 'fabric_code'>, cat: TextileCatalogs): Textile {
  return textileOfColor(item.size_grid.rows[0]?.color ?? '', cat, item.fabric_code);
}

/**
 * Смена цвета изделия: нанесения с подложкой, равной умолчанию прежнего
 * цвета, получают умолчание нового. Выбранное руками (≠ прежнему умолчанию)
 * и техники без подложки не трогаются; менять нечего — тот же массив.
 */
export function retextilePrints(prints: SalesPrint[], from: Textile, to: Textile): SalesPrint[] {
  if (from === to) return prints;
  let changed = false;
  const out = prints.map((p) => {
    if (!TEXTILE_METHODS.includes(p.method) || p.textile !== from) return p;
    changed = true;
    return { ...p, textile: to };
  });
  return changed ? out : prints;
}
