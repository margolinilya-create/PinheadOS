/**
 * Столбец матрицы ТЗ «зона × техника» (К7): Ш / В / Т / DTG / П.
 *
 * - Т — трансфер: DTF, флекс (термоперенос) и сублимация (тоже перенос с бумаги);
 * - П — прочее и подряд: техника «прочее», шевроны (нашивка — не печать цеха)
 *   и **любая** техника с подрядчиком (решение 23 плана 5б).
 *
 * Полнота по `SalesPrintMethod` — тип `Record` плюс тест на `METHOD_LABELS`.
 */
import type { SalesPrintMethod } from '../../model/types';

export type TzColumn = 'Ш' | 'В' | 'Т' | 'DTG' | 'П';

/** Порядок столбцов в таблице */
export const TZ_COLUMNS: readonly TzColumn[] = ['Ш', 'В', 'Т', 'DTG', 'П'];

export const METHOD_TZ_COLUMN: Record<SalesPrintMethod, TzColumn> = {
  silkscreen: 'Ш',
  embroidery: 'В',
  dtf: 'Т',
  heat_transfer: 'Т',
  sublimation: 'Т',
  dtg: 'DTG',
  patch: 'П',
  other: 'П',
};

/** Столбец нанесения: подрядчик — П при любой технике; неизвестная техника — П */
export function tzColumnOf(method: SalesPrintMethod, contractor: string | null | undefined): TzColumn {
  if ((contractor ?? '').trim() !== '') return 'П';
  return METHOD_TZ_COLUMN[method] ?? 'П';
}
