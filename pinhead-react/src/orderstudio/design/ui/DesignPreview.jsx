import { useEffect, useMemo, useState } from 'react';
import { loadFlatMarkup } from '../assets/flatImages';
import { loadArtworkImage } from '../assets/artworkImages';
import { toPngDataUrl } from './previewImages';
import { buildPreviewSvg } from '../export/buildPreviewSvg';
import { svgToDataUrl } from '../export/flatMarkup';
import { placementOf } from '../model/layout';
import { VIEW_NAMES } from './canvas/canvasText';
import { viewsOf } from './useItemFlat';
import styles from './DesignTab.module.css';

async function buildView(orderId, view, placements, colorHex) {
  const flat = await loadFlatMarkup(view);
  if (!flat) return null;
  const images = {};
  for (const pl of placements) {
    images[pl.print_key] = toPngDataUrl(await loadArtworkImage(orderId, pl.artwork_path, pl.asset.has_preview));
  }
  const svg = buildPreviewSvg({ view, flatMarkup: flat.markup, flatMm: flat.flatMm, garmentColor: colorHex, placements, images });
  return svgToDataUrl(svg);
}

/**
 * Вкладка «Дизайн» на ширине ≤ 760 px — только просмотр (Global Constraints):
 * статичное превью видов `buildPreviewSvg` → очищенный SVG → `<img>`. Скрипты
 * внутри `<img>` не исполняются, холст konva на телефоне не монтируется.
 */
export default function DesignPreview({ orderId, item, flat, colorHex }) {
  const groups = useMemo(() => {
    const placed = item.prints.map((p) => placementOf(p, flat)).filter(Boolean);
    // Все виды флэта по порядку холста, рукава тоже (5б); `flat` — флэт версии позиции
    const views = viewsOf(flat).map((kind) => flat.views.find((v) => v.kind === kind));
    const withPrints = views.filter((v) => placed.some((pl) => pl.view === v.kind));
    return (withPrints.length ? withPrints : views.slice(0, 1)).map((v) => ({ view: v, placements: placed.filter((pl) => pl.view === v.kind) }));
  }, [item.prints, flat]);
  const [urls, setUrls] = useState({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const next = {};
      for (const g of groups) {
        try {
          next[g.view.kind] = await buildView(orderId, g.view, g.placements, colorHex);
        } catch (e) {
          console.error('DesignPreview', e);
          next[g.view.kind] = null;
        }
      }
      if (alive) setUrls(next);
    })();
    return () => { alive = false; };
  }, [orderId, groups, colorHex]);

  return (
    <div className={styles.section}>
      <p className={styles.muted}>На телефоне холст только для просмотра — правка на компьютере или планшете.</p>
      <div className={styles.preview}>
        {groups.map(({ view, placements }) => {
          const url = urls[view.kind];
          const alt = `${flat.name}, вид ${VIEW_NAMES[view.kind]}: нанесений ${placements.length}`;
          if (url === undefined) return <p key={view.kind} className={styles.muted}>Готовлю превью: {VIEW_NAMES[view.kind]}…</p>;
          if (url === null) return <p key={view.kind} className={styles.muted}>Превью вида «{VIEW_NAMES[view.kind]}» не собрано.</p>;
          return <img key={view.kind} className={styles.previewImg} src={url} alt={alt} />;
        })}
      </div>
    </div>
  );
}
