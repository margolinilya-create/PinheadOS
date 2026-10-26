/**
 * Справочники ТЗ (`TzCatalogs`) из стора визарда и справочника флэтов —
 * ОДНА сборка для отправки (T5) и для сверки при запуске (`tzcheck`, T6).
 *
 * Хэш содержимого ТЗ считается по документу, а документ — по справочникам
 * (подписи тканей, упаковки, бирок, строк матрицы, подвал). Соберут их
 * отправка и запуск по-разному — хэши не совпадут, и каждый запуск откажет
 * «ТЗ не соответствует…». Поэтому сборка — здесь, а не в экранах.
 *
 * Флэты читаются своим загрузчиком (`useFlatsCatalog`): пока он не ответил,
 * справочники не готовы (`null`) — сверять по пустому справочнику нельзя.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { useFlatsCatalog } from '../design/catalog/useFlatsCatalog';
import type { GarmentFlatsCatalog } from '../design/types';
import type { TzCatalogs } from './model/tzDocTypes';

/** Поля стора визарда, из которых собираются справочники ТЗ */
export interface TzCatalogSource {
  fabricsCatalog: unknown;
  extrasCatalog: unknown;
  labelLibrary: unknown;
  prices: unknown;
  zonesCatalog: unknown;
  suppliers: unknown;
  tzSettings: unknown;
  /** Каталог моделей — только код и категория (чек-лист: силуэт другой модели) */
  skuCatalog?: unknown;
}

const list = <T>(v: unknown): readonly T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Чистая сборка: стор визарда + справочник флэтов → `TzCatalogs` */
export function tzCatalogsOf(src: TzCatalogSource, flats: GarmentFlatsCatalog | null): TzCatalogs {
  const packOptions = (src.prices as { packOptions?: unknown } | null | undefined)?.packOptions;
  return {
    fabricsCatalog: list(src.fabricsCatalog),
    extrasCatalog: list(src.extrasCatalog),
    labelLibrary: (src.labelLibrary ?? null) as TzCatalogs['labelLibrary'],
    packOptions: list(packOptions),
    zonesCatalog: list(src.zonesCatalog),
    garmentFlats: flats,
    suppliers: list(src.suppliers),
    tzSettings: (src.tzSettings ?? null) as TzCatalogs['tzSettings'],
    skuCategories: skuCategoriesOf(src.skuCatalog),
  };
}

function skuCategoriesOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of list<{ code?: unknown; category?: unknown } | null>(raw)) {
    if (s && typeof s.code === 'string' && s.code && typeof s.category === 'string' && s.category) out[s.code] = s.category;
  }
  return out;
}

/** Справочники ТЗ для экрана; флэты ещё грузятся или не загрузились — `null` */
export function useTzCatalogs(): { catalogs: TzCatalogs | null; failed: boolean } {
  const src = useStore(useShallow((s) => ({
    fabricsCatalog: s.fabricsCatalog,
    extrasCatalog: s.extrasCatalog,
    labelLibrary: s.labelLibrary,
    prices: s.prices,
    zonesCatalog: s.zonesCatalog,
    suppliers: s.suppliers,
    tzSettings: s.tzSettings,
    skuCatalog: s.skuCatalog,
  })));
  const flats = useFlatsCatalog();
  const ready = flats.status === 'ready';
  const catalogs = useMemo(() => (ready ? tzCatalogsOf(src, flats.catalog) : null), [ready, src, flats.catalog]);
  return { catalogs, failed: flats.status === 'error' };
}
