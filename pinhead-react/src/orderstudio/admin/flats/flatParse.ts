/**
 * Разбор числовых полей редактора флэта для `BufferedInput` (веха 5б, задача 6б):
 * `undefined` — «ещё набирают, не значение», модель не трогается.
 */

/** Миллиметры: запятая как точка, в границах; пусто — `null` только у необязательного поля */
export function parseMm(text: string, min: number, max: number, optional = false): number | null | undefined {
  const t = String(text).trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return optional ? null : undefined;
  if (!/^-?\d+(\.\d*)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1000) / 1000 : undefined;
}
