/**
 * Вьюпорт холста (веха 5а, задача 6а; вынесено из DM `EditorCanvas.tsx` —
 * файл резался по правилу ≤ 500 строк): размер стейджа по контейнеру,
 * развёртка мм → px, экранный зум и панорама.
 *
 * Зум и панорама — в сторе дизайна (`zoom`, `pan`): их сбрасывает смена
 * позиции, а кнопки масштаба могут стоять и в шапке холста (задача 6б).
 * Метрика мм от них не зависит (`makeTransform` — только размер и флэт).
 *
 * Колесо масштабирует только с Ctrl/Cmd (и щипком трекпада — браузер шлёт
 * его как Ctrl+колесо): простое колесо листает страницу, холст прокрутку
 * не перехватывает. Без `ResizeObserver` (jsdom) — размер по умолчанию.
 */
import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useDesignStore } from '../../store/useDesignStore';
import { clampZoom, clientToMm, makeTransform, zoomAround, type MmPoint, type Point, type Size, type Transform } from './canvasMath';

export const DEFAULT_STAGE: Size = { width: 800, height: 640 };
/** Шаг кнопок и клавиш масштаба */
export const ZOOM_STEP = 1.2;
/** Шаг колеса */
export const WHEEL_STEP = 1.08;

/** Событие колеса konva в той мере, в какой его читает вьюпорт */
export interface WheelLike {
  evt: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'deltaY' | 'preventDefault'>;
  target: { getStage: () => { getPointerPosition: () => Point | null } | null };
}

/** Конец перетаскивания на стейдже: панорама — только если тащили сам стейдж */
export interface DragEndLike {
  target: { x: () => number; y: () => number; getStage: () => unknown };
}

export interface Viewport {
  size: Size;
  t: Transform;
  zoom: number;
  pan: Point;
  onWheel: (e: WheelLike) => void;
  zoomBy: (dir: 1 | -1) => void;
  fit: () => void;
  onStageDragEnd: (e: DragEndLike) => void;
  /** Точка экрана → мм флэта; контейнера нет — `null` */
  toMm: (clientX: number, clientY: number) => MmPoint | null;
}

function useContainerSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(DEFAULT_STAGE);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // Нулевой размер (скрытый контейнер) не берём: флэт «уехал» бы делением на ~0
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = el;
      if (width > 0 && height > 0) setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function useCanvasViewport(containerRef: RefObject<HTMLElement | null>, flatMm: { w: number; h: number }): Viewport {
  const size = useContainerSize(containerRef);
  const { zoom, pan, setZoom, setPan } = useDesignStore(useShallow((s) => ({
    zoom: s.zoom, pan: s.pan, setZoom: s.setZoom, setPan: s.setPan,
  })));
  const t = useMemo(() => makeTransform(size, flatMm), [size, flatMm]);

  const zoomTo = useCallback((next: number, at: Point) => {
    const z = clampZoom(next);
    if (z === zoom) return;
    setPan(zoomAround(at, zoom, z, pan));
    setZoom(z);
  }, [zoom, pan, setPan, setZoom]);

  const onWheel = useCallback((e: WheelLike) => {
    if (!e.evt.ctrlKey && !e.evt.metaKey) return;
    e.evt.preventDefault();
    const pointer = e.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    zoomTo(zoom * (e.evt.deltaY > 0 ? 1 / WHEEL_STEP : WHEEL_STEP), pointer);
  }, [zoom, zoomTo]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    zoomTo(dir > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP, { x: size.width / 2, y: size.height / 2 });
  }, [zoom, zoomTo, size]);

  const fit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [setZoom, setPan]);

  const onStageDragEnd = useCallback((e: DragEndLike) => {
    if (e.target === e.target.getStage()) setPan({ x: e.target.x(), y: e.target.y() });
  }, [setPan]);

  const toMm = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    return clientToMm({ x: clientX, y: clientY }, el.getBoundingClientRect(), pan, zoom, t);
  }, [containerRef, pan, zoom, t]);

  return { size, t, zoom, pan, onWheel, zoomBy, fit, onStageDragEnd, toMm };
}
