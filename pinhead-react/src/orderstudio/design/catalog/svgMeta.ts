// Чтение чисел из SVG без интерпретации. Перенос DM `lib/catalog/svgMeta.ts`
// (без `imageNaturalSize`: размеры растра читает `assets/sniff` из заголовка).
// Макеты (`assets/loadAsset`): width/height с единицами важнее viewBox;
// флэты (`export/resolveFlat`): viewBox по договорённости — мм.

/** viewBox → ширина и высота в единицах viewBox; `null` — атрибута нет */
export function parseViewBox(svgText: string): { w: number; h: number } | null {
  const vb = svgText.match(
    /viewBox\s*=\s*["']\s*([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)[\s,]+([\d.-]+)/i,
  );
  if (!vb) return null;
  return { w: parseFloat(vb[3]), h: parseFloat(vb[4]) };
}
