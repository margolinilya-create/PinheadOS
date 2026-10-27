import { useEffect, useMemo, useState } from 'react';
import { loadArtworkImage } from '../../assets/artworkImages';
import { VIEW_LABELS } from '../../catalog/flatLabels';
import { buildPatternSvg } from '../../export/buildPatternSvg';
import { svgToDataUrl } from '../../export/flatMarkup';
import { placementOf } from '../../model/layout';
import { viewsOf } from '../useItemFlat';
import { toPngDataUrl } from '../previewImages';
import styles from './stage.module.css';

/**
 * Лист «Выкройка» (веха 5в, Э2б): детали кроя позиции с лекалами — в
 * натуральную величину рядом, с нанесениями, зонами и линейкой. Только показ:
 * очищенный SVG (`buildPatternSvg`) → `<img>`, ничего не пишет. Править —
 * кнопкой детали: «Разметка» на её виде. Своим ленивым чанком, без konva.
 */
export default function PatternSheet({ orderId, item, flat, colorHex, onEdit }) {
  const pieces = useMemo(() => {
    const placed = item.prints.map((p) => placementOf(p, flat)).filter(Boolean);
    return viewsOf(flat).map((kind) => flat.views.find((v) => v.kind === kind))
      .filter((v) => v?.pattern)
      .map((v) => ({ view: v, title: VIEW_LABELS[v.kind], placements: placed.filter((pl) => pl.view === v.kind) }));
  }, [item.prints, flat]);
  const [url, setUrl] = useState(undefined);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const withImages = [];
        for (const p of pieces) {
          const images = {};
          for (const pl of p.placements) images[pl.print_key] = toPngDataUrl(await loadArtworkImage(orderId, pl.artwork_path, pl.asset.has_preview));
          withImages.push({ ...p, images });
        }
        const svg = buildPatternSvg({ pieces: withImages, garmentColor: colorHex });
        if (alive) setUrl(svg ? svgToDataUrl(svg) : null);
      } catch (e) {
        console.error('PatternSheet', e);
        if (alive) setUrl(null);
      }
    })();
    return () => { alive = false; };
  }, [orderId, pieces, colorHex]);

  const count = pieces.reduce((n, p) => n + p.placements.length, 0);
  const names = pieces.map((p) => p.title.toLowerCase()).join(', ');
  return (
    <section className={styles.sheet} aria-label="Выкройка">
      {url === undefined && <p className={styles.hint} role="status">Собираю выкройку…</p>}
      {url === null && <p className={styles.hint} role="alert">Выкройку не удалось собрать — переключитесь на «Разметку».</p>}
      {url && (
        <div className={styles.sheetScroll}>
          <img className={styles.sheetImg} src={url} alt={`Выкройка: ${names}; нанесений ${count}`} />
        </div>
      )}
      <div className={styles.group} role="group" aria-label="Править деталь">
        <p className={styles.groupTitle} aria-hidden="true">Править деталь:</p>
        {pieces.map((p) => (
          <button key={p.view.kind} type="button" className={styles.chipBtn} onClick={() => onEdit(p.view.kind)}>{p.title}</button>
        ))}
      </div>
    </section>
  );
}
