import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Stage, Layer, Image as KImage, Transformer } from '../konva';
import { DesignIcon } from '../DesignIcon';
import { placementOf } from '../../model/layout';
import { defaultAreaId } from '../../geometry/view';
import { polygonToZone } from '../../geometry/coords';
import { NEUTRAL_GARMENT_HEX } from '../../assets/garmentHex';
import { useFlatImage } from '../../assets/useFlatImage';
import { toast } from '../../../../store/useToastStore';
import { FLAT_MM_FALLBACK, areaAt, fromNode, isDarkHex, isOutOfZone, snapCenter, snapTargets, toNode } from './canvasMath';
import { CANVAS_LABELS } from './canvasChange';
import { ANNOUNCE_DELAY_MS, VIEW_NAMES, announcePrint, canvasHint, canvasLabel } from './canvasText';
import { useCanvasViewport } from './useCanvasViewport';
import { useCanvasKeys, useRotationSnap, LAYER_MIME, ROTATION_SNAPS } from './useCanvasKeys';
import { useCanvasTheme } from './useCanvasTheme';
import { usePlacementImages } from './usePlacementImages';
import { GridLines, ZoneShapes, NamedAxes, DimensionOverlay, SnapGuides } from './canvasOverlays';
import { PlacementNode } from './PlacementNode';
import styles from './EditorCanvas.module.css';

/**
 * Холст вкладки «Дизайн» (веха 5а, задача 6а; перенос DM `EditorCanvas.tsx`,
 * разрезан на этот файл, `useCanvasViewport`, `useCanvasKeys`).
 *
 * КОНТРАКТ для панели (задача 6б):
 *
 *   <EditorCanvas flat view prints selectedKey readOnly onSelect onCommit onDropFile
 *                 orderId colorHex onUndo onRedo />
 *
 * - `flat` — флэт позиции (`GarmentFlat`, не null: без флэта холст не
 *   монтируется — плашка панели); `view` — 'front' | 'back';
 * - `prints` — нанесения позиции (`item.prints`); на холсте — те, у кого
 *   раскладка на этом флэте и виде (`placementOf`). Порядок слоёв = порядок
 *   `prints` (номер в ТЗ): первое рисуется ниже всех;
 * - `selectedKey` / `onSelect(key | null)` — выбор (стор дизайна `select`);
 * - `readOnly` — без перетаскивания, трансформера и клавиш правки; выбор,
 *   обвязка и масштаб остаются;
 * - `onCommit(change)` — правка с холста (`canvasChange.ts`: `place`, `nudge`,
 *   `unplace`); применяет панель через `applyCanvasChange` внутри
 *   `useDesignStore.commit(change.label, …, change.coalesceKey)`. Холст сам
 *   ничего не пишет, а открытие и перерисовка правок не порождают;
 * - `onDropFile(file, { at, areaId })` — файл брошен на холст или вставлен
 *   Ctrl+V (тогда без `at`): форма = `AddArtworkOpts`, можно отдать прямо
 *   `useAddArtwork(...).addFile`;
 * - `orderId` — заказ (картинки логотипов из его бакета); `colorHex` — цвет
 *   ткани (`garmentHexOf`), по умолчанию нейтральный;
 * - `onUndo` / `onRedo` — Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (стор дизайна).
 *
 * Delete на холсте — `unplace` («Снять с изделия», без подтверждения): тост
 * «Нанесение снято с холста · Вернуть» и фокус на строку слоя — у панели.
 * Холст занимает всю высоту родителя (высоту задаёт панель), кнопки масштаба
 * («−», «+», «Вписать») — внутри холста, масштаб и панорама — в сторе дизайна.
 *
 * Состояние готовности для эталонного снимка — `data-ready="true"` у области
 * холста: флэт и все картинки вида решились (пришли или не вышло).
 */

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const MIN_BOX_PX = 8;

const minBox = (oldBox, newBox) => (Math.abs(newBox.width) < MIN_BOX_PX || Math.abs(newBox.height) < MIN_BOX_PX ? oldBox : newBox);
const geometryOf = (p) => ({
  x_mm: p.x_mm, y_mm: p.y_mm, width_mm: p.width_mm, height_mm: p.height_mm,
  rotation_deg: p.rotation_deg, flip_h: p.flip_h, flip_v: p.flip_v,
});
const nodeAttrs = (n) => ({
  x: n.x(), y: n.y(), width: n.width(), height: n.height(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY(),
});

export function EditorCanvas({
  flat, view, prints, selectedKey, readOnly, onSelect, onCommit, onDropFile,
  orderId, colorHex = NEUTRAL_GARMENT_HEX, onUndo, onRedo, display = 'markup',
  onDuplicate, onCopyLayer, onPasteLayer,
}) {
  // «Как на изделии» (веха 5в, Э2): без зон, осей, сетки, выноски и гайдов — правка та же
  const markup = display !== 'garment';
  const containerRef = useRef(null);
  const trRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const hintId = useId();
  const [guides, setGuides] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  // Счётчик концов перетаскивания: после правки узлы сверяются с пропсами (правка не прошла — откат)
  const [settleRev, bumpSettle] = useReducer((n) => n + 1, 0);

  const flatView = flat.views.find((v) => v.kind === view) ?? null;
  const flatImg = useFlatImage(flat, view, colorHex);
  const flatMm = flatImg.flatMm ?? FLAT_MM_FALLBACK;
  const vp = useCanvasViewport(containerRef, flatMm);
  const { t } = vp;
  const { colors, coarse } = useCanvasTheme(containerRef);
  const darkFabric = isDarkHex(colorHex);

  const items = useMemo(
    () => prints
      .map((print, index) => ({ print, index, pl: placementOf(print, flat) }))
      .filter((x) => x.pl && x.pl.view === view),
    [prints, flat, view],
  );
  const refs = useMemo(
    () => items.map(({ pl }) => ({ key: pl.print_key, path: pl.artwork_path, hasPreview: pl.asset.has_preview })),
    [items],
  );
  const { images, settled } = usePlacementImages(orderId, refs);
  const selected = items.find((x) => x.pl.print_key === selectedKey) ?? null;

  const onKeyDown = useCanvasKeys({
    readOnly, selectedKey: selected ? selected.pl.print_key : null, onSelect, onCommit, onUndo, onRedo, onDuplicate, zoomBy: vp.zoomBy, fit: vp.fit,
  });
  useRotationSnap(trRef);

  /** Узел konva нанесения по ключу — к нему цепляется трансформер */
  const registerRef = useCallback((key, node) => {
    if (node) nodeRefs.current.set(key, node);
    else nodeRefs.current.delete(key);
  }, []);

  // Трансформер — на узле выбранного (только при правке)
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected && !readOnly ? nodeRefs.current.get(selected.pl.print_key) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, readOnly]);

  // Узлы = пропсы: react-konva не переставит узел, если пропсы не изменились (правка отклонена)
  useLayoutEffect(() => {
    if (!settleRev) return;
    for (const { pl } of items) nodeRefs.current.get(pl.print_key)?.setAttrs(toNode(pl, t));
  }, [settleRev, items, t]);

  // Пересказ выбранного — с паузой
  const liveText = selected && flatView ? announcePrint(selected.index, selected.print, isOutOfZone(flatView, selected.pl)) : '';
  const [live, setLive] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setLive(liveText), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [liveText]);

  const centerOf = (node) => ({ cx: (node.x() - t.px(0)) / t.pxPerMM, cy: (node.y() - t.py(0)) / t.pxPerMM });

  const onDragMove = (pl, node) => {
    if (!flatView) return;
    const { cx, cy } = centerOf(node);
    const s = snapCenter(cx, cy, snapTargets(flatView, pl.area_id));
    node.position({ x: t.px(s.cx), y: t.py(s.cy) });
    const next = s.guideX === undefined && s.guideY === undefined ? null : { x: s.guideX, y: s.guideY };
    setGuides((g) => (g?.x === next?.x && g?.y === next?.y ? g : next));
  };

  const onDragEnd = (pl, node) => {
    setGuides(null);
    if (!flatView || readOnly) return;
    const { cx, cy } = centerOf(node);
    const s = snapCenter(cx, cy, snapTargets(flatView, pl.area_id));
    onCommit({
      kind: 'place', key: pl.print_key, label: CANVAS_LABELS.move,
      geometry: { ...geometryOf(pl), x_mm: s.cx - pl.width_mm / 2, y_mm: s.cy - pl.height_mm / 2 },
    });
    bumpSettle();
  };

  const onTransformEnd = (pl, node) => {
    if (readOnly) return;
    onCommit({ kind: 'place', key: pl.print_key, label: CANVAS_LABELS.transform, geometry: fromNode(nodeAttrs(node), t) });
    bumpSettle();
  };

  const onStageClick = (e) => {
    if (e.target === e.target.getStage()) onSelect(null);
  };

  const canDrop = !readOnly && typeof onDropFile === 'function';
  // По одному файлу; сбой одного — тост, остальные не теряются молча и промис не повисает
  const dropFiles = (files, opts) => {
    void (async () => {
      for (const file of files) {
        try {
          await onDropFile(file, opts);
        } catch (err) {
          console.error('EditorCanvas: onDropFile', err);
          toast.error(`Логотип «${file.name}» не добавлен — попробуйте ещё раз`);
        }
      }
    })();
  };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragOver = (e) => {
    if (!canDrop || !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };
  const onDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDropActive(false);
  };
  const onDrop = (e) => {
    setDropActive(false);
    if (!canDrop || !hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    if (!files.length) return;
    const at = vp.toMm(e.clientX, e.clientY);
    const hit = at && Number.isFinite(at.x_mm) && Number.isFinite(at.y_mm);
    dropFiles(files, hit ? { at, areaId: flatView ? areaAt(flatView, at.x_mm, at.y_mm) : undefined } : {});
  };
  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    // Файл важнее слоя; слой — только по метке своего копирования (веха 5в, Э2)
    const token = files.length ? '' : e.clipboardData?.getData(LAYER_MIME);
    if (token && onPasteLayer) {
      e.preventDefault();
      onPasteLayer(token);
      return;
    }
    if (!canDrop || !files.length) return;
    e.preventDefault();
    dropFiles(files, {});
  };
  const onCopy = (e) => {
    const token = selected && onCopyLayer ? onCopyLayer(selected.pl.print_key) : null;
    if (!token) return;
    e.clipboardData?.setData(LAYER_MIME, token);
    e.preventDefault();
  };

  const gridAreaId = selected?.pl.area_id ?? defaultAreaId(flat, view);
  const gridArea = flatView?.print_areas.find((a) => a.id === gridAreaId) ?? null;
  const gridZone = gridArea ? polygonToZone(gridArea.polygon_mm) : null;
  const ready = flatImg.status !== 'loading' && settled;

  let notice = null;
  if (flatImg.status === 'loading') notice = 'Загружаю силуэт…';
  else if (flatImg.status === 'error') notice = 'Силуэт не загрузился — нанесения видны без него';
  else if (!flatView) notice = `У силуэта нет вида «${VIEW_NAMES[view]}»`;
  const empty = flatView && items.length === 0;

  return (
    <div className={styles.root}>
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
          role="application" — свой виджет холста (план, «Клавиатура»): фокус, клавиши, сброс и вставку
          файла он обрабатывает сам; jsx-a11y относит эту роль к неинтерактивным */}
      <div
        ref={containerRef}
        className={styles.canvas}
        role="application"
        tabIndex={0}
        aria-label={canvasLabel(flat.name, view, !markup)}
        aria-describedby={hintId}
        data-ready={ready ? 'true' : 'false'}
        onKeyDown={onKeyDown}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onPaste={onPaste}
        onCopy={onCopy}
      >
        <Stage
          width={vp.size.width}
          height={vp.size.height}
          scaleX={vp.zoom}
          scaleY={vp.zoom}
          x={vp.pan.x}
          y={vp.pan.y}
          draggable
          onWheel={vp.onWheel}
          onClick={onStageClick}
          onTap={onStageClick}
          onDragEnd={vp.onStageDragEnd}
        >
          <Layer listening={false}>
            {flatImg.image && (
              <KImage image={flatImg.image} x={t.px(0)} y={t.py(0)} width={t.s(flatMm.w)} height={t.s(flatMm.h)} />
            )}
            {markup && gridArea && <GridLines area={gridArea} t={t} darkFabric={darkFabric} />}
            {markup && flatView && <ZoneShapes view={flatView} t={t} colors={colors} darkFabric={darkFabric} />}
            {markup && flatView && <NamedAxes view={flatView} t={t} flatH={flatMm.h} colors={colors} />}
          </Layer>
          <Layer>
            {flatView && items.map(({ pl }) => (
              <PlacementNode
                key={pl.print_key}
                placement={pl}
                view={flatView}
                t={t}
                image={images[pl.print_key]}
                selected={pl.print_key === selectedKey}
                draggable={!readOnly}
                coarse={coarse}
                colors={colors}
                onSelect={onSelect}
                registerRef={registerRef}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
                onTransformEnd={onTransformEnd}
              />
            ))}
            {!readOnly && (
              <Transformer
                ref={trRef}
                keepRatio
                rotationSnaps={ROTATION_SNAPS}
                enabledAnchors={CORNERS}
                anchorSize={coarse ? 24 : 10}
                rotateAnchorOffset={coarse ? 36 : 24}
                borderStroke={colors.accent}
                anchorStroke={colors.accent}
                anchorFill={colors.halo}
                ignoreStroke
                boundBoxFunc={minBox}
              />
            )}
          </Layer>
          <Layer listening={false}>
            {markup && selected && flatView && <DimensionOverlay view={flatView} placement={selected.pl} t={t} colors={colors} />}
            {markup && <SnapGuides guides={guides} t={t} flatMm={flatMm} colors={colors} />}
          </Layer>
        </Stage>

        {notice && <p className={styles.notice}>{notice}</p>}
        {!notice && empty && (
          <p className={styles.empty}>
            {readOnly ? 'На этом виде нанесений нет' : 'Перетащите логотип сюда или нажмите «Загрузить логотип»'}
          </p>
        )}
        {dropActive && <p className={styles.drop}>Отпустите, чтобы поставить логотип на изделие</p>}
        {markup && gridArea && gridZone && (
          <p className={styles.status}>
            {gridArea.name}: {Math.round(gridZone.zw)} × {Math.round(gridZone.zh)} мм
          </p>
        )}
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}

      <div className={styles.zoomBar} role="group" aria-label="Масштаб холста">
        <button type="button" className={styles.zoomBtn} onClick={() => vp.zoomBy(-1)} aria-label="Уменьшить">
          <DesignIcon name="zoomOut" />
        </button>
        <output className={styles.zoomValue} aria-live="off">{Math.round(vp.zoom * 100)} %</output>
        <button type="button" className={styles.zoomBtn} onClick={() => vp.zoomBy(1)} aria-label="Увеличить">
          <DesignIcon name="zoomIn" />
        </button>
        <button type="button" className={styles.zoomBtn} onClick={vp.fit} aria-label="Вписать в окно">
          <DesignIcon name="fit" />
        </button>
      </div>

      <p id={hintId} className={styles.srOnly}>{canvasHint(readOnly)}</p>
      <p className={styles.srOnly} aria-live="polite">{live}</p>
    </div>
  );
}
