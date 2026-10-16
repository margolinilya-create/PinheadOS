/**
 * Разбор и показ значений для `BufferedInput`: `parse` отдаёт `undefined`,
 * пока набранное ещё не значение, — тогда модель не трогается.
 */

/** Деньги: пусто — `null`, запятая — десятичная, отрицательное и мусор — не значение */
export function parseMoney(text: string): number | null | undefined {
  const t = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return undefined;
  return Number(t);
}

export const formatMoney = (v: number | null | undefined): string => (v == null ? '' : String(v).replace('.', ','));

/** Pantone: список через запятую; пробелы внутри названия («186 C») сохраняются */
export const parsePantone = (text: string): string[] => String(text).split(',').map((s) => s.trim()).filter(Boolean);
export const formatPantone = (list: string[] | null | undefined): string => (list ?? []).join(', ');

/** Целое в границах: вне границ — ещё набирают, не значение */
export function parseIntIn(min: number, max: number) {
  return (text: string): number | undefined => {
    const t = String(text).trim();
    if (!/^\d+$/.test(t)) return undefined;
    const n = Number(t);
    return n >= min && n <= max ? n : undefined;
  };
}
