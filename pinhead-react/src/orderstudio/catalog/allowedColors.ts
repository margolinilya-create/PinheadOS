/**
 * Ограничение цветов модели (`allowedColors`, К10 вехи 8) — по палитре
 * поставщика ткани.
 *
 * Форма прежняя: `string[]` кодов или `null` (без ограничения). Коды цветов
 * уникальны по всем палитрам, поэтому список, собранный по одной палитре
 * (исторически — Медастекс), у ткани другого поставщика пересекается с её
 * палитрой пусто. Пустая палитра в выборе цвета — тупик, а не ограничение:
 * пустое пересечение значит «ограничение к этой ткани не относится» —
 * предлагается палитра целиком.
 */

/** Что читается из правил модели: только список кодов */
export interface AllowedColorsRule {
  allowedColors?: readonly string[] | null;
}

/**
 * Цвета палитры, разрешённые модели, в порядке палитры; `null` — ограничения
 * для этой палитры нет (нет правила, пустой список или пустое пересечение).
 * Входные массивы не меняются.
 */
export function allowedFor<T extends { code: string }>(
  rules: AllowedColorsRule | null | undefined,
  palette: readonly T[],
): T[] | null {
  const codes = rules?.allowedColors;
  if (!codes || codes.length === 0) return null;
  const allowed = new Set(codes);
  const picked = palette.filter((c) => allowed.has(c.code));
  return picked.length > 0 ? picked : null;
}
