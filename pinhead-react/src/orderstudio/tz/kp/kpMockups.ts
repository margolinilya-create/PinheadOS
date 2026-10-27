/**
 * Мокапы для КП (веха 5в, Э6): позиция → превью вида с нанесениями в цвете
 * первой строки сетки (`buildPreviewSvg`, очищенный SVG). Флэт — версии
 * раскладок позиции (`flatAtVersion`). Нет силуэта или нанесений — `null`
 * (КП без картинки). Грузится только `import()` вместе с движком КП.
 */
import type { SalesOrder } from '../../model/types';
import type { TzCatalogs } from '../model/tzDocTypes';
import { flatAtVersion, itemFlatVersion } from '../../design/catalog/flatVersion';
import { placementOf } from '../../design/model/layout';
import { loadFlatMarkup } from '../../design/assets/flatImages';
import { loadArtworkImage } from '../../design/assets/artworkImages';
import { garmentHexOf } from '../../design/assets/garmentHex';
import { buildPreviewSvg } from '../../design/export/buildPreviewSvg';
import type { Placement } from '../../design/types';
import { toPngDataUrl } from '../../design/ui/previewImages';

export function kpMockupLoader(order: SalesOrder, catalogs: Pick<TzCatalogs, 'garmentFlats' | 'suppliers'> | null) {
  return async (itemKey: string): Promise<{ svg: string; aspect: number } | null> => {
    const item = order.items.find((it) => it.key === itemKey);
    const cur = item?.flat_id ? catalogs?.garmentFlats?.flats.find((f) => f.id === item.flat_id) : undefined;
    if (!item || !cur) return null;
    const flat = flatAtVersion(cur, itemFlatVersion(item.prints, cur).version) ?? cur;
    const placed = item.prints.map((p) => placementOf(p, flat)).filter((p): p is Placement => !!p);
    const view = flat.views.find((v) => placed.some((p) => p.view === v.kind));
    if (!view) return null;
    const markup = await loadFlatMarkup(view);
    if (!markup) return null;
    const pls = placed.filter((p) => p.view === view.kind);
    const images: Record<string, string> = {};
    for (const p of pls) images[p.print_key] = toPngDataUrl(await loadArtworkImage(order.id, p.artwork_path, p.asset.has_preview)) ?? '';
    const svg = buildPreviewSvg({
      view, flatMarkup: markup.markup, flatMm: markup.flatMm, garmentColor: garmentHexOf(item, catalogs?.suppliers ?? []), placements: pls, images,
    });
    return { svg, aspect: markup.flatMm.h / markup.flatMm.w };
  };
}
