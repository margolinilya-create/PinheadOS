// ═══════════════════════════════════════════
// Поиск тканей по всему каталогу (правка CRM 13.10, п. 10)
// ═══════════════════════════════════════════
/**
 * Запрос — слова через пробел; КАЖДОЕ должно найтись хоть в одном поле:
 * название, поставщик, состав, плотность, категории, где ткань применима,
 * и названия моделей этих категорий. Так работают сочетания «худи медас
 * футер», «поло пике 215», «шоппер канвас». Регистр и «ё» не важны.
 */
import type { Fabric, SkuItem, SkuCategory } from '../types/catalog';

const norm = (v: string): string => v.toLowerCase().replace(/ё/g, 'е');

export function fabricHaystack(f: Fabric, categories: SkuCategory[] = [], skus: Pick<SkuItem, 'name' | 'code' | 'category'>[] = []): string {
  const cats = f.forCategories || [];
  const parts = [
    f.name, f.supplier, f.composition, f.density ? `${f.density} ${f.density}г` : '', f.code,
    ...cats,
    ...categories.filter((c) => cats.includes(c.id)).map((c) => c.name),
    ...skus.filter((s) => cats.includes(s.category)).flatMap((s) => [s.name, s.code]),
  ];
  return norm(parts.filter(Boolean).join(' '));
}

export function searchFabrics<T extends Fabric>(
  fabrics: T[], query: string, categories: SkuCategory[] = [], skus: Pick<SkuItem, 'name' | 'code' | 'category'>[] = [],
): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return fabrics;
  return fabrics.filter((f) => {
    const hay = fabricHaystack(f, categories, skus);
    return words.every((w) => hay.includes(w));
  });
}
