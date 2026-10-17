/**
 * Тип изделия DM ↔ категория прайс-каталога PH (`SkuItem.category`).
 * Нужен сиду (задача 4: `categories` типового флэта) и подбору (`pickFlat`).
 * Олимпийка у нас в категории поло (`SKU_CATEGORIES`: «Поло / Регбийка /
 * Олимпийка»), шоппер — аксессуар. Сторож — у каждого типа есть категория
 * из `SKU_CATEGORIES` (`categoryMap.test.ts`).
 */
import type { GarmentType } from '../types';

export const GARMENT_TYPE_CATEGORY: Record<GarmentType, string> = {
  tshirt: 'tshirts',
  longsleeve: 'longsleeves',
  sweatshirt: 'sweatshirts',
  hoodie: 'hoodies',
  zip_hoodie: 'ziphoodies',
  half_zip: 'halfzips',
  polo: 'polo',
  olympic: 'polo',
  bomber: 'bombers',
  pants: 'pants',
  shopper: 'accessories',
};

/** Изделие без горловины: отступ меряется от верхнего края, а не от шва */
export function isAccessoryType(t: GarmentType): boolean {
  return GARMENT_TYPE_CATEGORY[t] === 'accessories';
}

/** Типы DM, которые ложатся в категорию PH */
export function typesOfCategory(category: string): GarmentType[] {
  return (Object.keys(GARMENT_TYPE_CATEGORY) as GarmentType[]).filter((t) => GARMENT_TYPE_CATEGORY[t] === category);
}
