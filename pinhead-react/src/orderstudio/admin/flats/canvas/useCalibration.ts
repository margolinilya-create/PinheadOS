/**
 * Отмер калибровки на холсте редактора флэта (веха 5б, К11): две точки в мм
 * флэта → `onMeasured(длина, мм)`. Третий клик начинает отмер заново; выход
 * из режима и Esc (`clear`) сбрасывают точки. Рисует отмер `CalibrateTool.jsx`.
 */
import { useCallback, useState } from 'react';
import { distanceMm, type Point } from './canvasMath';

export interface Calibration {
  points: Point[];
  /** Длина последнего отмера, мм; отмера нет — `null` */
  measured: number | null;
  add: (mm: Point) => void;
  /** Сбросить отмер; `true` — было что сбрасывать */
  clear: () => boolean;
}

export function useCalibration(active: boolean, onMeasured?: (mm: number) => void): Calibration {
  const [points, setPoints] = useState<Point[]>([]);
  const [measured, setMeasured] = useState<number | null>(null);
  const [wasActive, setWasActive] = useState(active);

  // Вышли из режима — отмер не переживает смену режима (поправка состояния при рендере, без эффекта)
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) {
      setPoints([]);
      setMeasured(null);
    }
  }

  const add = useCallback((mm: Point) => {
    if (points.length !== 1) {
      setPoints([mm]);
      setMeasured(null);
      return;
    }
    const d = distanceMm(points[0], mm);
    setPoints([points[0], mm]);
    setMeasured(d);
    onMeasured?.(d);
  }, [points, onMeasured]);

  const clear = useCallback(() => {
    const had = points.length > 0;
    setPoints([]);
    setMeasured(null);
    return had;
  }, [points.length]);

  return { points, measured, add, clear };
}
