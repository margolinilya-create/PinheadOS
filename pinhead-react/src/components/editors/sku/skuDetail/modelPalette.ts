/**
 * Палитра модели для ограничения цветов (`overrides.allowedColors`, К10 вехи 8):
 * объединение палитр поставщиков тканей модели, а не палитра Медастекса.
 *
 * Ткани модели — ткани её категории (`forCategories`), а если у модели задан
 * список допустимых тканей (`allowedFabrics`) — только они. Поставщик каждой
 * ткани — `supplierForFabric` (привязка по имени поставщика ткани, иначе
 * палитра по умолчанию). Значение ограничения прежнее — `string[]` кодов:
 * коды уникальны по всем палитрам, и выбор на «Изделии» пересекает список
 * с палитрой ткани позиции (`allowedFor`).
 */
import { offeredColors, supplierForFabric } from '../../../../orderstudio/catalog/suppliers';
import type { PaletteColor, Supplier } from '../../../../orderstudio/catalog/types';

export interface ModelLike {
  category?: string | null;
  allowedFabrics?: readonly string[] | null;
}

export interface FabricEntry {
  code: string;
  supplier?: string | null;
  forCategories?: readonly string[] | null;
}

export interface PaletteBlock {
  supplier: Supplier;
  colors: PaletteColor[];
}

/** Ткани модели: её категории и, если задано, из списка допустимых */
export function modelFabrics<T extends FabricEntry>(model: ModelLike, fabrics: readonly T[]): T[] {
  const cat = model.category ?? '';
  const allowed = model.allowedFabrics?.length ? new Set(model.allowedFabrics) : null;
  return fabrics.filter((f) => (f.forCategories ?? []).includes(cat) && (!allowed || allowed.has(f.code)));
}

/**
 * Палитры поставщиков тканей модели без повторов, в порядке справочника
 * поставщиков; только предлагаемые цвета. Тканей нет — палитра по умолчанию
 * (`supplierForFabric` её же отдаёт ткани без привязки).
 */
export function modelPalettes(
  model: ModelLike,
  fabrics: readonly FabricEntry[],
  suppliers: readonly Supplier[],
): PaletteBlock[] {
  const own = modelFabrics(model, fabrics);
  const sources = own.length > 0 ? own : [{ code: '', supplier: '' }];
  const ids = new Set(
    sources.map((f) => supplierForFabric(f, suppliers)?.id).filter((id): id is string => Boolean(id)),
  );
  return suppliers
    .filter((s) => ids.has(s.id))
    .map((s) => ({ supplier: s, colors: offeredColors(s) }))
    .filter((b) => b.colors.length > 0);
}

/** Все коды палитр модели (для «все цвета» и счётчика «N из M») */
export function paletteCodes(blocks: readonly PaletteBlock[]): string[] {
  return [...new Set(blocks.flatMap((b) => b.colors.map((c) => c.code)))];
}
