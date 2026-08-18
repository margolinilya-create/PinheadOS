/**
 * Каталог изделий и материалов как ИСТОЧНИК ПОДСКАЗОК для производственного заказа.
 *
 * ПОЧЕМУ ЭТОТ МОДУЛЬ ЕСТЬ. До правки поля «Изделие» и «Крой» в форме заказа
 * подсказывались из `erp_dictionaries` — плоского списка строк, который заводят
 * руками. Настоящий каталог (`sku_catalog`, `fabricsCatalog`, `trimCatalog`)
 * с ценами, зонами нанесения, размерными сетками и фото жил в Order Studio
 * и при выключенном флаге был недостижим вовсе. То есть в системе было два
 * списка изделий, и производственный не знал про товарный.
 *
 * Решение заказчика: каталог — источник правды, справочники остаются под то,
 * чего в каталоге нет (поставщики, единицы, причины блокировок, операции).
 *
 * ПОЧЕМУ НЕ ЧЕРЕЗ `useStore` ВИЗАРДА. Стор Order Studio — это семь слайсов
 * со всем состоянием визарда; импорт из ERP притащил бы его в чанк формы
 * заказа целиком. `lib/catalogs.loadAllCatalogs()` — тонкий модуль (supabase +
 * sessionStorage), уже с кэшем на 30 минут и защитой от параллельных запросов,
 * и он ровно про «дай каталоги».
 *
 * Загрузка ЛЕНИВАЯ и только по требованию: `main.jsx` зовёт `loadCatalogs()`
 * лишь при включённом флаге Order Studio, и тянуть каталоги во входной чанк
 * ERP нельзя — бюджет критического пути. Спрашивают их форма создания заказа
 * и вкладка библиотеки в админке, обе и так за ленивой границей.
 */

import { loadAllCatalogs } from '../../lib/catalogs';

/** Подписи кроя: коды в каталоге английские, в заказе человек читает подпись */
export const FIT_LABELS: Record<string, string> = {
  regular: 'Regular',
  oversize: 'Oversize',
  free: 'Free Fit',
  classic: 'Classic',
};

export interface CatalogRefs {
  /** Названия изделий из каталога SKU */
  productTypes: string[];
  /** Варианты кроя, встречающиеся в каталоге (подписями) */
  fits: string[];
  /** Названия основных тканей */
  fabrics: string[];
  /** Названия отделочных материалов */
  trims: string[];
}

export const EMPTY_REFS: CatalogRefs = {
  productTypes: [], fits: [], fabrics: [], trims: [],
};

/** Уникальные непустые значения в порядке первого появления */
function uniq(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** Массив из сырого каталога; всё, что не массив, читается как «каталога нет» */
function rows(raw: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = raw[key];
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
}

function text(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Сырые каталоги → списки подсказок. Чистая функция: сеть, кэш и React
 * остаются снаружи, поэтому маппинг проверяется тестами целиком.
 *
 * Ткань называется парой «название + состав + плотность»: в каталоге восемь
 * «Кулирок», отличающихся только ими, и одно название не даёт закупщику
 * ответа, что именно покупать.
 */
export function catalogRefsFrom(raw: Record<string, unknown> | null | undefined): CatalogRefs {
  if (!raw || typeof raw !== 'object') return EMPTY_REFS;

  const sku = rows(raw, 'skuCatalog');
  const fabrics = rows(raw, 'fabricsCatalog');
  const trims = rows(raw, 'trimCatalog');

  const fabricLabel = (r: Record<string, unknown>): string | null => {
    const name = text(r, 'name');
    if (!name) return null;
    const density = typeof r.density === 'number' ? `${r.density} г/м²` : null;
    const parts = [name, text(r, 'composition'), density].filter(Boolean);
    return parts.join(' · ');
  };

  return {
    productTypes: uniq(sku.map((r) => text(r, 'name'))),
    // Крой берётся из каталога, а не из перечисления: у SKU он уже проставлен,
    // и список сам сжимается до того, что фабрика действительно шьёт.
    fits: uniq(sku.map((r) => {
      const code = text(r, 'fit');
      return code ? (FIT_LABELS[code] ?? code) : null;
    })),
    fabrics: uniq(fabrics.map(fabricLabel)),
    trims: uniq(trims.map(fabricLabel)),
  };
}

/** Каталоги из Supabase (кэш и дедупликация — внутри `loadAllCatalogs`) */
export async function loadCatalogRefs(): Promise<CatalogRefs> {
  try {
    return catalogRefsFrom(await loadAllCatalogs());
  } catch (e) {
    // Подсказки — не данные заказа: их отсутствие не должно ломать форму
    // и не должно показываться человеку ошибкой. Поле остаётся свободным вводом.
    console.warn('[catalogRefs] каталоги не загрузились:', e);
    return EMPTY_REFS;
  }
}
