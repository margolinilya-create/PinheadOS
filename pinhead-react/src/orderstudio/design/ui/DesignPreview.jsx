import { useEffect, useMemo, useState } from 'react';
import { loadFlatMarkup } from '../assets/flatImages';
import { loadArtworkImage } from '../assets/artworkImages';
import { buildPreviewSvg } from '../export/buildPreviewSvg';
import { svgToDataUrl } from '../export/flatMarkup';
import { placementOf } from '../model/layout';
import { VIEW_NAMES } from './canvas/canvasText';
import styles from './DesignTab.module.css';

/** Сторона растра логотипа в превью, px — для экрана телефона хватает */
const PREVIEW_PX = 1024;

/**
 * Картинка логотипа → `data:image/png` (превью строится только из `data:`,
 * H1). Холст из чистой картинки (object URL того же источника); не вышло —
 * `undefined`, логотип в превью не рисуется
 */
function toPngDataUrl(img) {
  if (!img?.naturalWidth || !img?.naturalHeight) return undefined;
  try {
    const k = Math.min(1, PREVIEW_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = canvas.getContext('2d');
    if (!g) return undefined;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('DesignPreview: логотип', e);
    return undefined;
  }
}

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
    const views = flat.views.filter((v) => v.kind === 'front' || v.kind === 'back');
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
