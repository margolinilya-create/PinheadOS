/**
 * Клавиатура холста (веха 5а, задача 6а; план, «Клавиатура»; перенос
 * `onKeyDown` DM `EditorCanvas.tsx`):
 * - стрелки — сдвиг выбранного на 1 мм, с Shift — на 10 мм (серия сливается
 *   в один шаг отмены ключом `nudge:<ключ>`);
 * - Delete / Backspace — «Снять с изделия» (без подтверждения: строка
 *   нанесения остаётся, тост «Вернуть» — у панели; проверка скиллами);
 * - Ctrl/Cmd+Z — отменить, Ctrl/Cmd+Shift+Z и Ctrl+Y — вернуть; клавиша
 *   узнаётся и по коду (`KeyZ`), иначе на русской раскладке «я» не сработала бы;
 * - Esc — снять выбор; «+», «−», «0» — масштаб и «вписать».
 *
 * Только чтение — ни одной правки: выбор и масштаб остаются. Чужие сочетания
 * (Ctrl+C, Ctrl+V — вставка ловится событием `paste`, Alt+…, Tab) не гасятся:
 * Tab уводит фокус с холста, ловушки нет.
 *
 * `useRotationSnap` — Shift при повороте трансформером: шаг 15° (план).
 */
import { useCallback, useEffect } from 'react';
import { CANVAS_LABELS, type CanvasChange } from './canvasChange';

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type KeyAction =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'deselect' }
  | { type: 'unplace' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'zoom'; dir: 1 | -1 }
  | { type: 'fit' };

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const isKey = (e: KeyLike, code: string, letters: string) => e.code === code || letters.includes(e.key);

/** Что значит клавиша на холсте; `null` — не наша, событие не гасить */
export function keyAction(e: KeyLike, s: { readOnly: boolean; hasSelection: boolean }): KeyAction | null {
  if (e.altKey) return null;
  if (e.ctrlKey || e.metaKey) {
    if (s.readOnly) return null;
    if (isKey(e, 'KeyZ', 'zZяЯ')) return { type: e.shiftKey ? 'redo' : 'undo' };
    if (isKey(e, 'KeyY', 'yYнН')) return { type: 'redo' };
    return null;
  }
  if (e.key === '+' || e.key === '=') return { type: 'zoom', dir: 1 };
  if (e.key === '-') return { type: 'zoom', dir: -1 };
  if (e.key === '0') return { type: 'fit' };
  if (!s.hasSelection) return null;
  if (e.key === 'Escape') return { type: 'deselect' };
  if (s.readOnly) return null;
  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'unplace' };
  const arrow = ARROWS[e.key];
  if (!arrow) return null;
  const step = e.shiftKey ? 10 : 1;
  return { type: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
}

export interface CanvasKeysOpts {
  readOnly: boolean;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onCommit: (change: CanvasChange) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  zoomBy: (dir: 1 | -1) => void;
  fit: () => void;
}

/** Обработчик `onKeyDown` контейнера холста */
export function useCanvasKeys(o: CanvasKeysOpts): (e: KeyLike & { preventDefault: () => void }) => void {
  const { readOnly, selectedKey: key, onSelect, onCommit, onUndo, onRedo, zoomBy, fit } = o;
  return useCallback((e) => {
    const a = keyAction(e, { readOnly, hasSelection: key !== null });
    if (!a) return;
    e.preventDefault();
    if (a.type === 'undo') onUndo?.();
    else if (a.type === 'redo') onRedo?.();
    else if (a.type === 'zoom') zoomBy(a.dir);
    else if (a.type === 'fit') fit();
    else if (a.type === 'deselect') onSelect(null);
    else if (key && a.type === 'unplace') onCommit({ kind: 'unplace', key, label: CANVAS_LABELS.unplace });
    else if (key && a.type === 'nudge') {
      onCommit({ kind: 'nudge', key, dx_mm: a.dx, dy_mm: a.dy, label: CANVAS_LABELS.nudge, coalesceKey: `nudge:${key}` });
    }
  }, [readOnly, key, onSelect, onCommit, onUndo, onRedo, zoomBy, fit]);
}

/** Углы-магниты трансформера без Shift и с Shift (шаг 15°) */
export const ROTATION_SNAPS = [0, 90, 180, 270];
export const SHIFT_ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

interface RotationSnapTarget {
  rotationSnaps: (v: number[]) => unknown;
  rotationSnapTolerance: (v: number) => unknown;
}

/** Shift зажат — трансформер поворачивает шагом 15°; отпущен (или окно потеряло фокус) — прежние углы */
export function useRotationSnap(trRef: { current: RotationSnapTarget | null }): void {
  useEffect(() => {
    const apply = (shift: boolean) => {
      const tr = trRef.current;
      if (!tr) return;
      tr.rotationSnaps(shift ? SHIFT_ROTATION_SNAPS : ROTATION_SNAPS);
      tr.rotationSnapTolerance(shift ? 7.5 : 5);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Shift') apply(e.type === 'keydown'); };
    const onBlur = () => apply(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [trRef]);
}
