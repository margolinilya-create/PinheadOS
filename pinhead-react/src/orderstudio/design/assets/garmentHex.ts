/**
 * Цвет ткани позиции для силуэта (веха 5а, задача 5) — лёгкая часть
 * `flatImages`: её читают синхронно вкладка, холст и кнопка PDF, а кэш
 * картинок флэтов грузится по требованию (`imageLayer`, потолок холста).
 *
 * Цвет — по первой строке сетки: `colorCodeOf` (подпись «Чёрный (15-01)»
 * → код) → `findPaletteColor` → hex; не распознан — нейтральный `#d9d9d9`.
 */
import { findPaletteColor } from '../../catalog/suppliers';
import type { Supplier } from '../../catalog/types';
import type { SalesItem } from '../../model/types';
import { colorCodeOf } from '../../wizard/wizardAdapter';
import { sanitizeHex } from '../../../utils/sanitizeHex';

/** Цвет силуэта, когда цвет ткани не распознан */
export const NEUTRAL_GARMENT_HEX = '#d9d9d9';

/** Hex по форме (`sanitizeHex` его не меняет) */
export const validHex = (hex: unknown): hex is string => typeof hex === 'string' && sanitizeHex(hex) === hex;

/** Hex ткани позиции: первая строка сетки с цветом → код палитры → hex; иначе нейтральный */
export function garmentHexOf(
  item: Pick<SalesItem, 'size_grid'>,
  suppliers: readonly Supplier[],
  preferred?: Supplier | null,
  /** Цвет для показа (веха 5в, Э2: «Показать на цвете»); ТЗ и PDF его не передают — первая строка */
  color?: string | null,
): string {
  const label = color?.trim() || (item.size_grid.rows.find((r) => r.color.trim())?.color ?? '');
  const code = label ? colorCodeOf(label, suppliers, preferred) : '';
  const hex = code ? findPaletteColor(code, suppliers, preferred)?.hex : undefined;
  return validHex(hex) ? hex : NEUTRAL_GARMENT_HEX;
}
