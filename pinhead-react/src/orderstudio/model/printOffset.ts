/**
 * Отступ нанесения текстом — одна функция на холст (aria-live), строку
 * нанесения, легенду PDF макета и ТЗ (веха 6+7, задача 2; техдолг: было три копии).
 *
 * Формулировка — как в цехе и в образцах ТЗ: «80 мм от шва горловины»
 * (вниз от опоры — «от»), «5 мм выше шва горловины», у центра — «левее» /
 * «правее». Опора `other` и пустая — отступа нет (текст опоры — в `offset_note`).
 */
import type { PrintOffsetDir, PrintOffsetFrom, SalesPrint } from './types';

/** Опора отступа — в родительном падеже */
export const OFFSET_FROM_TEXT: Record<PrintOffsetFrom, string> = {
  '': '',
  neck_seam: 'шва горловины',
  top_edge: 'верхнего края',
  part_seam: 'шва детали',
  center: 'центра',
  other: '',
};

const OFFSET_DIR_TEXT: Record<PrintOffsetDir, string> = {
  '': 'от',
  down: 'от',
  up: 'выше',
  left: 'левее',
  right: 'правее',
};

/** «80 мм от шва горловины»; мм или опоры нет — пусто */
export function offsetText(p: Pick<SalesPrint, 'offset_mm' | 'offset_from' | 'offset_dir'>): string {
  const from = OFFSET_FROM_TEXT[p.offset_from] ?? '';
  if (p.offset_mm === null || p.offset_mm === undefined || !from) return '';
  return `${p.offset_mm} мм ${OFFSET_DIR_TEXT[p.offset_dir] ?? 'от'} ${from}`;
}
