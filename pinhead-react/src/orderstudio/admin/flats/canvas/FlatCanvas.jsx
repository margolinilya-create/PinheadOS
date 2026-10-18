import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Image as KImage, Rect, Transformer } from '../../../design/ui/konva';
import { AreaShapes } from './AreaShapes';
import { AnchorGuides, AnchorHandles } from './AnchorHandles';
import { CalibrateLayer } from './CalibrateTool';
import { useCalibration } from './useCalibration';
import { FLAT_MM_FALLBACK, MIN_AREA_MM, fit, lenPx, toMm, toPx } from './canvasMath';
import {
  ANNOUNCE_DELAY_MS, CANVAS_HINT, CANVAS_HINT_READONLY, announceArea, announceMeasured, buildScene, sceneText,
} from './sceneText';
import { useCanvasTokens } from './useCanvasTokens';
import { useFlatCanvasKeys } from './useFlatCanvasKeys';
import { useStageSize } from './useStageSize';
import { useSvgImage } from './useSvgImage';
import styles from './FlatCanvas.module.css';

/**
 * Холст редактора флэта (веха 5б, задача 6а; DM `FlatEditorCanvas` +
 * `ZoneEditor` + `SkuViewCanvas`, разрезаны по файлам `canvas/*`).
 *
 * КОНТРАКТ (фиксирован для задачи 6б):
 *
 *   <FlatCanvas markup flatMm view accessory selectedAreaId readOnly mode
 *               onSelectArea onAreaRect onAreaPoint onAnchors onMeasured label />
 *
 * - `markup` — очищенный SVG вида (черновик или база) или `null`; `flatMm` — габарит, мм;
 * - `view` — вид черновика (якоря и зоны); `accessory` — без горловины;
 * - `mode` — 'select' (рамки и якоря) | 'calibrate' (два клика → `onMeasured(мм)`) |
 *   'points' (вершины выбранной зоны → `onAreaPoint(id, index, [x, y])`);
 * - `onAreaRect(id, {x, y, w, h})` — конец перетаскивания или трансформации, стрелки;
 * - `onAnchors(патч якорей)` — конец перетаскивания ручки;
 * - `readOnly` — без ручек, трансформера и обработчиков правки; выбор остаётся.
 *
 * Холст сам ничего не хранит, кроме отмера калибровки и выбранной вершины:
 * правку применяет родитель. Выбор зоны на холсте (мышь, `[`/`]`, PageUp/PageDown)
 * фокус с холста НЕ уводит. `data-ready` — SVG декодирован (или его нет) и слой
 * отрисован; `data-scene` — детерминированная сцена (`sceneText`) для e2e.
 */

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** Пальцем: ручка трансформера 20 px + невидимая обводка попадания 24 px = 44 px */
const TR_ANCHOR = { fine: 10, coarse: 20 };
const TR_HIT_COARSE = 24;

export function FlatCanvas({
  markup, flatMm, view, accessory = false, selectedAreaId = null, readOnly = false, mode = 'select',
  onSelectArea, onAreaRect, onAreaPoint, onAnchors, onMeasured, label,
}) {
  const rootRef = useRef(null);
  const containerRef = useRef(null);
  const layerRef = useRef(null);
  const trRef = useRef(null);
  const nodes = useRef(new Map());
  const hintId = useId();

  const size = useStageSize(containerRef);
  const { tokens, coarse } = useCanvasTokens(rootRef);
  const img = useSvgImage(markup, tokens.garment);
  const fm = flatMm && flatMm.w > 0 && flatMm.h > 0 ? flatMm : FLAT_MM_FALLBACK;
  const f = useMemo(() => fit(size, fm), [size, fm]);

  const scene = useMemo(
    () => buildScene({ view, flatMm: fm, accessory, selectedAreaId, readOnly, mode }),
    [view, fm, accessory, selectedAreaId, readOnly, mode],
  );
  const selected = scene.areas.find((a) => a.selected) ?? null;

  // Вершина в режиме «Точки»: сбрасывается при смене зоны и режима
  const [point, setPoint] = useState({ area: null, index: null });
  const pointIndex = point.area === selectedAreaId && mode === 'points' ? point.index : null;
  const pickPoint = useCallback((index) => setPoint({ area: selectedAreaId, index }), [selectedAreaId]);

  const calibration = useCalibration(mode === 'calibrate' && !readOnly, onMeasured);
  const onKeyDown = useFlatCanvasKeys({
    scene, readOnly, mode, pointIndex, onSelectArea, onAreaRect, onAreaPoint, clearMeasure: calibration.clear,
  });

  const registerRef = useCallback((id, node) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  // Трансформер — на рамке выбранной прямоугольной зоны, только при правке в режиме «Выбор»
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected?.rect && !readOnly && mode === 'select' ? nodes.current.get(selected.id) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, readOnly, mode, scene]);

  // Готовность для эталона: картинка решилась — слой рисуется сразу, затем `data-ready`
  // (атрибут ставится здесь, а не разметкой: он означает «нарисовано», а не «отрендерено React»)
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (img.status === 'loading') {
      el.dataset.ready = 'false';
      return;
    }
    layerRef.current?.draw?.();
    el.dataset.ready = 'true';
  }, [img.status, img.image, markup]);

  // Пересказ — с паузой: серия стрелок не тараторит
  const liveText = mode === 'calibrate' && calibration.measured !== null
    ? announceMeasured(calibration.measured)
    : selected ? announceArea(selected) : '';
  const [live, setLive] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setLive(liveText), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
  }, [liveText]);

  const onStagePointer = (e) => {
    const stage = e.target.getStage?.();
    if (mode === 'calibrate' && !readOnly) {
      const p = stage?.getPointerPosition?.();
      if (p) calibration.add(toMm(f, p));
      return;
    }
    if (e.target === stage && selectedAreaId !== null) onSelectArea(null);
  };

  const minPx = lenPx(f, MIN_AREA_MM);
  const boundBox = (oldBox, newBox) => (Math.abs(newBox.width) < minPx || Math.abs(newBox.height) < minPx ? oldBox : newBox);
  const anchorStyle = coarse ? (anchor) => anchor.hitStrokeWidth(TR_HIT_COARSE) : undefined;
  const paper = toPx(f, { x: 0, y: 0 });

  let notice = null;
  if (img.status === 'none') notice = 'Файла силуэта у вида нет — загрузите SVG';
  else if (img.status === 'error') notice = 'Силуэт не показан: файл не открылся — загрузите SVG заново';

  return (
    <div ref={rootRef} className={styles.root}>
      {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
          role="application" — свой виджет холста (план, «Клавиатура»): фокус и клавиши он обрабатывает сам;
          jsx-a11y относит эту роль к неинтерактивным */}
      <div
        ref={containerRef}
        className={styles.canvas}
        role="application"
        tabIndex={0}
        aria-label={label}
        aria-describedby={hintId}
        data-mode={mode}
        data-scene={sceneText(scene)}
        onKeyDown={onKeyDown}
      >
        <Stage width={size.width} height={size.height} onClick={onStagePointer} onTap={onStagePointer}>
          <Layer ref={layerRef} listening={false}>
            <Rect x={paper.x} y={paper.y} width={lenPx(f, fm.w)} height={lenPx(f, fm.h)} fill={tokens.paper} />
            {img.image && <KImage image={img.image} x={paper.x} y={paper.y} width={lenPx(f, fm.w)} height={lenPx(f, fm.h)} />}
            <AnchorGuides scene={scene} f={f} flatMm={fm} tokens={tokens} />
          </Layer>
          <Layer listening={mode !== 'calibrate'}>
            <AreaShapes
              scene={scene}
              f={f}
              tokens={tokens}
              coarse={coarse}
              readOnly={readOnly}
              onSelect={onSelectArea}
              onRect={onAreaRect}
              onPoint={onAreaPoint}
              pointIndex={pointIndex}
              onPointPick={pickPoint}
              registerRef={registerRef}
            />
            {!readOnly && mode === 'select' && (
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                keepRatio={false}
                enabledAnchors={CORNERS}
                anchorSize={coarse ? TR_ANCHOR.coarse : TR_ANCHOR.fine}
                anchorStyleFunc={anchorStyle}
                padding={coarse ? 6 : 0}
                ignoreStroke
                borderStroke={tokens.zone}
                anchorStroke={tokens.zone}
                anchorFill={tokens.halo}
                boundBoxFunc={boundBox}
              />
            )}
            <AnchorHandles scene={scene} f={f} tokens={tokens} coarse={coarse} onAnchors={onAnchors} />
          </Layer>
          <Layer listening={false}>
            <CalibrateLayer points={calibration.points} f={f} tokens={tokens} />
          </Layer>
        </Stage>
        {notice && <p className={styles.notice}>{notice}</p>}
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <p id={hintId} className={styles.srOnly}>{readOnly ? CANVAS_HINT_READONLY : CANVAS_HINT}</p>
      <p className={styles.srOnly} aria-live="polite">{live}</p>
    </div>
  );
}

export default FlatCanvas;
