/**
 * Флэт позиции (решение 7 плана вехи 5а). Чистая функция: ничего не пишет —
 * открытие вкладки «Дизайн» не меняет заказ, `flat_id` записывается тем же
 * `edit`, что и первое размещение, либо явным выбором.
 *
 * Порядок:
 * 1. `item.flat_id`, если флэт активен (снятый — как будто флэта нет: его
 *    раскладки не показываются на холсте и остаются строками нанесений);
 * 2. точный — `sku_codes` содержит код модели;
 * 3. типовой — категория модели и посадка;
 * 4. типовой — только категория;
 * 5. нет — плашка «Для этой модели нет силуэта».
 * При равенстве — меньший `id` (детерминированно, проверка скиллами).
 *
 * Флэт позиции обязан подходить её модели — по коду (`sku_codes`) либо по
 * категории. Посадка — только предпочтение автоподбора, не условие: иначе
 * флэт, подобранный «типовым по категории» (шаг 4), сразу после записи
 * `flat_id` признавался бы чужим, а явно выбранный силуэт другой посадки
 * навсегда держал бы плашку (ревью T3, раунд 1). Сменили модель на вкладке
 * «Изделие» на другую категорию — `modelChanged` и предложенный силуэт;
 * перенос делает `remapToFlat` по действию менеджера, сам по себе — нет.
 */
import type { SalesItem } from '../../model/types';
import type { SkuItem } from '../../../types/catalog';
import type { GarmentFlat, GarmentFlatsCatalog } from '../types';

export type FlatPickSource = 'item' | 'exact' | 'typical-fit' | 'typical-category';

export interface FlatPick {
  /** Флэт для холста; `null` — силуэта нет */
  flat: GarmentFlat | null;
  source: FlatPickSource | null;
  /** Флэт позиции не подходит её модели (модель сменили) */
  modelChanged: boolean;
  /** Подходящий силуэт для новой модели, когда `modelChanged` */
  suggested: GarmentFlat | null;
}

type ItemRef = Pick<SalesItem, 'flat_id' | 'sku_code' | 'fit'>;
type SkuRef = Pick<SkuItem, 'code' | 'category' | 'fit'> | null | undefined;
type FitRef = Pick<SalesItem, 'sku_code'>;
type FitSkuRef = Pick<SkuItem, 'category'> | null | undefined;

const byId = (a: GarmentFlat, b: GarmentFlat) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function fitOf(item: ItemRef, sku: SkuRef): string {
  return item.fit || sku?.fit || '';
}

/**
 * Подходит ли флэт модели: та же категория, либо точный по коду — но код
 * засчитывается только внутри категории модели или у флэта без категорий
 * (веха 5в, B1: код худи, привязанный к флэту футболки, ставил худи на футболку).
 * Посадку не сверяем — её учитывает только автоподбор (`autoPickFlat`), иначе
 * подбор и проверка противоречили бы друг другу. Одно правило для холста,
 * чек-листа отправки и админки флэтов
 */
export function flatFitsModel(flat: GarmentFlat, item: FitRef, sku: FitSkuRef): boolean {
  const category = sku?.category;
  if (category && flat.categories.includes(category)) return true;
  if (!item.sku_code || !flat.sku_codes.includes(item.sku_code)) return false;
  return !category || flat.categories.length === 0;
}

/** Флэт есть, модель известна, и флэт ей не подходит (B1). Модель неизвестна — не судим */
export function flatMismatch(flat: GarmentFlat | null | undefined, item: FitRef, sku: FitSkuRef): boolean {
  return !!flat && !!sku?.category && !flatFitsModel(flat, item, sku);
}

/** Силуэты для выбора у позиции: активные и подходящие модели, по id; модель неизвестна — все активные */
export function flatsForModel(catalog: GarmentFlatsCatalog, item: FitRef, sku: FitSkuRef): GarmentFlat[] {
  return catalog.flats.filter((f) => f.active && (!sku?.category || flatFitsModel(f, item, sku))).sort(byId);
}

/** Автоподбор без учёта `item.flat_id`: точный → типовой по крою → типовой по категории */
export function autoPickFlat(item: ItemRef, sku: SkuRef, catalog: GarmentFlatsCatalog): { flat: GarmentFlat; source: FlatPickSource } | null {
  const active = catalog.flats.filter((f) => f.active).sort(byId);
  const exact = item.sku_code ? active.find((f) => f.sku_codes.includes(item.sku_code) && flatFitsModel(f, item, sku)) : undefined;
  if (exact) return { flat: exact, source: 'exact' };
  const category = sku?.category;
  if (!category) return null;
  const typical = active.filter((f) => f.typical && f.categories.includes(category));
  const fit = fitOf(item, sku);
  const byFit = fit ? typical.find((f) => f.fits.includes(fit)) : undefined;
  if (byFit) return { flat: byFit, source: 'typical-fit' };
  return typical[0] ? { flat: typical[0], source: 'typical-category' } : null;
}

/** Флэт позиции (порядок — в шапке модуля) */
export function pickFlat(item: ItemRef, sku: SkuRef, catalog: GarmentFlatsCatalog): FlatPick {
  const stored = item.flat_id ? catalog.flats.find((f) => f.id === item.flat_id) : undefined;
  if (stored && stored.active) {
    if (flatFitsModel(stored, item, sku)) return { flat: stored, source: 'item', modelChanged: false, suggested: null };
    const auto = autoPickFlat(item, sku, catalog);
    return { flat: stored, source: 'item', modelChanged: true, suggested: auto?.flat ?? null };
  }
  const auto = autoPickFlat(item, sku, catalog);
  return { flat: auto?.flat ?? null, source: auto?.source ?? null, modelChanged: false, suggested: null };
}

/**
 * Точный силуэт для позиции на типовом (веха 5б, Р12): у позиции записан
 * типовой флэт (`item.flat_id`), а автоподбор по коду модели даёт точный
 * (`sku_codes`) — его и предложить: «Для модели появился точный силуэт».
 * Флэт не записан, снят, уже точный или точного нет — `null`. Ничего не пишет:
 * перенос — по кнопке (`remapToFlat`)
 */
export function exactUpgrade(item: ItemRef, sku: SkuRef, catalog: GarmentFlatsCatalog): GarmentFlat | null {
  const stored = item.flat_id ? catalog.flats.find((f) => f.id === item.flat_id) : undefined;
  if (!stored || !stored.active || !stored.typical) return null;
  const auto = autoPickFlat(item, sku, catalog);
  return auto && auto.source === 'exact' && auto.flat.id !== stored.id ? auto.flat : null;
}
