/**
 * Флэт позиции НА ВЕРСИИ ПОЗИЦИИ (веха 5б, задача 5; К15, Review Focus 1).
 *
 * - `current` — флэт позиции (`pickFlat`), текущая версия справочника;
 * - `flat` — флэт версии раскладок позиции: `flatAtVersion(current,
 *   itemFlatVersion(prints, current).version)`. По нему рисуют холст, превью,
 *   PDF и проверка, и на него же ставятся новые размещения (`PlaceCtx.flat`):
 *   у позиции на v1 `layout.flat_version` остаётся 1 и после перетаскивания,
 *   и при новом размещении. Раскладок нет — текущая версия; версий несколько
 *   или версии нет в истории — текущая (`stale`, как в 5а);
 * - `outdated` — позиция стоит не на текущей версии (плашка «Силуэт обновлён»,
 *   перенос — только по кнопке и только в черновике: открытие ничего не пишет);
 * - `upgrade` — точный силуэт для позиции на типовом (Р12, `exactUpgrade`);
 * - `views` — виды флэта в порядке перед → спина → левый → правый рукав;
 * - `areaAllowed` — фильтр зон нового размещения: только зоны модели
 *   (`zonesForSku`), служебные (`zone_id = null`) — всегда; уже размещённые
 *   не трогаются. Модели нет — без фильтра.
 */
import { useMemo } from 'react';
import type { SalesItem, SalesPrint } from '../../model/types';
import type { SkuItem, ZoneDefinition } from '../../../types/catalog';
import { zonesForSku } from '../../../utils/skuRules';
import { DESIGN_VIEWS, type DesignView, type GarmentFlat, type GarmentFlatsCatalog, type PrintArea } from '../types';
import { flatAtVersion, itemFlatVersion, type ItemFlatVersion } from '../catalog/flatVersion';
import { exactUpgrade } from '../catalog/pickFlat';
import { parseLayout } from '../model/layoutMark';
import { remapToFlat } from '../model/layout';

export interface ItemFlat {
  current: GarmentFlat | null;
  flat: GarmentFlat | null;
  version: ItemFlatVersion | null;
  outdated: boolean;
  upgrade: GarmentFlat | null;
  views: DesignView[];
  areaAllowed: ((area: PrintArea) => boolean) | null;
}

/** Виды флэта по порядку холста */
export function viewsOf(flat: GarmentFlat | null): DesignView[] {
  return flat ? DESIGN_VIEWS.filter((k) => flat.views.some((v) => v.kind === k)) : [];
}

/** Флэт версии позиции и признак «стоит не на текущей версии» */
export function resolveItemFlat(current: GarmentFlat | null, prints: readonly SalesPrint[]): Pick<ItemFlat, 'flat' | 'version' | 'outdated'> {
  if (!current) return { flat: null, version: null, outdated: false };
  const version = itemFlatVersion(prints, current);
  const flat = flatAtVersion(current, version.version) ?? current;
  return { flat, version, outdated: version.mixed || !version.known || version.version !== current.version };
}

/** Раскладка этого флэта прежней (не текущей) версии */
export function onOldVersion(print: SalesPrint, current: GarmentFlat): boolean {
  const l = parseLayout(print.layout);
  return !!l && l.flat_id === current.id && l.flat_version !== current.version;
}

/**
 * «Перенести на версию M»: раскладки прежних версий этого флэта — на текущую
 * (`remapToFlat`); раскладки текущей версии не трогаются. Зоны нет в новой
 * версии — раскладка снята, строка осталась (`dropped`)
 */
export function transferToCurrent(
  prints: SalesPrint[],
  current: GarmentFlat,
  ctx: { zonesCatalog: ZoneDefinition[]; category: string },
): { prints: SalesPrint[]; dropped: number } | null {
  const old = new Set(prints.filter((p) => onOldVersion(p, current)).map((p) => p.key));
  if (old.size === 0) return null;
  const res = remapToFlat(prints, current, { flat: current, ...ctx });
  return {
    prints: prints.map((p, i) => (old.has(p.key) ? res.prints[i] : p)),
    dropped: res.dropped.filter((k) => old.has(k)).length,
  };
}

interface ItemFlatInput {
  item: Pick<SalesItem, 'flat_id' | 'sku_code' | 'fit' | 'prints' | 'extras'>;
  current: GarmentFlat | null;
  sku: SkuItem | null;
  catalog: GarmentFlatsCatalog;
  zonesCatalog: ZoneDefinition[];
  extrasCatalog: { code: string; name?: string }[];
}

export function useItemFlat({ item, current, sku, catalog, zonesCatalog, extrasCatalog }: ItemFlatInput): ItemFlat {
  const resolved = useMemo(() => resolveItemFlat(current, item.prints), [current, item.prints]);
  const upgrade = useMemo(() => exactUpgrade(item, sku, catalog), [item, sku, catalog]);
  const views = useMemo(() => viewsOf(resolved.flat), [resolved.flat]);
  const areaAllowed = useMemo(() => {
    if (!sku || zonesCatalog.length === 0) return null;
    const ids = new Set(zonesForSku(zonesCatalog, sku, item.extras, extrasCatalog).map((z) => z.id));
    return (area: PrintArea) => area.zone_id === null || ids.has(area.zone_id);
  }, [sku, zonesCatalog, item.extras, extrasCatalog]);
  return { current, ...resolved, upgrade, views, areaAllowed };
}
