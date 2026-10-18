/**
 * Клавиатура холста редактора флэта (веха 5б, задача 6а; план, «Клавиатура»):
 * - стрелки — сдвиг выбранной зоны на 1 мм, с Shift — на 10 мм
 *   (`onAreaRect`); в режиме «Точки» — сдвиг выбранной вершины (`onAreaPoint`);
 *   многоугольник в режиме «Выбор» стрелками не двигается — молча
 *   в прямоугольник он не превращается (К12);
 * - `[` и `]`, PageUp и PageDown — соседняя зона (по кругу); фокус остаётся
 *   на холсте, имя зоны озвучивает live-регион;
 * - Esc — сбросить отмер калибровки, иначе снять выбор;
 * - Tab и Shift+Tab НЕ перехватываются; ресайза стрелками нет (подсказка
 *   об этом говорит) — размер правится полями панели.
 *
 * `readOnly` — только выбор зоны и Esc.
 */
import { useCallback, type KeyboardEvent } from 'react';
import { arrowDelta, neighborId, nudgeRect } from './canvasMath';
import type { CanvasMode, Scene } from './sceneText';
import type { Rect } from '../../../design/edit/flatEdit';

export interface CanvasKeysOpts {
  scene: Scene;
  readOnly: boolean;
  mode: CanvasMode;
  /** Выбранная вершина в режиме «Точки» */
  pointIndex: number | null;
  onSelectArea: (id: string | null) => void;
  onAreaRect?: (id: string, rect: Rect) => void;
  onAreaPoint?: (id: string, index: number, p: [number, number]) => void;
  /** Esc: сбросить отмер калибровки; `true` — было что сбрасывать */
  clearMeasure: () => boolean;
}

const tenth = (v: number) => Math.round(v * 10) / 10;
const PREV = new Set(['[', 'PageUp']);
const NEXT = new Set([']', 'PageDown']);

export function useFlatCanvasKeys(o: CanvasKeysOpts): (e: KeyboardEvent) => void {
  const { scene, readOnly, mode, pointIndex, onSelectArea, onAreaRect, onAreaPoint, clearMeasure } = o;
  return useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const selected = scene.areas.find((a) => a.selected) ?? null;

    if (PREV.has(e.key) || NEXT.has(e.key)) {
      e.preventDefault();
      const id = neighborId(scene.areas.map((a) => a.id), selected?.id ?? null, NEXT.has(e.key) ? 1 : -1);
      if (id !== null && id !== selected?.id) onSelectArea(id);
      return;
    }
    if (e.key === 'Escape') {
      if (clearMeasure()) return;
      if (selected) {
        e.preventDefault();
        onSelectArea(null);
      }
      return;
    }

    const d = arrowDelta(e.key, e.shiftKey);
    if (!d || readOnly || !selected) return;
    if (mode === 'points') {
      const pt = pointIndex === null ? undefined : selected.points[pointIndex];
      if (!pt || !onAreaPoint) return;
      e.preventDefault();
      onAreaPoint(selected.id, pointIndex as number, [tenth(pt[0] + d.x), tenth(pt[1] + d.y)]);
      return;
    }
    if (mode !== 'select' || !selected.rect || !onAreaRect) return;
    e.preventDefault();
    onAreaRect(selected.id, nudgeRect(selected.box, d.x, d.y));
  }, [scene, readOnly, mode, pointIndex, onSelectArea, onAreaRect, onAreaPoint, clearMeasure]);
}
