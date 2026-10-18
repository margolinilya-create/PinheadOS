/**
 * Размер стейджа холста редактора флэта по контейнеру (веха 5б, задача 6а;
 * как `useContainerSize` холста 5а, который не экспортируется). Нулевой
 * размер (скрытый контейнер) не берётся — флэт «уехал» бы делением на ~0.
 * Без `ResizeObserver` (jsdom) — размер по умолчанию.
 */
import { useEffect, useState, type RefObject } from 'react';
import type { Size } from './canvasMath';

export const DEFAULT_STAGE: Size = { width: 800, height: 640 };

export function useStageSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>(DEFAULT_STAGE);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = el;
      if (width > 0 && height > 0) setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
