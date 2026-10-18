/**
 * Цвета холста редактора флэта из токенов (веха 5б, задача 6а). Konva рисует
 * в `<canvas>` и CSS-переменных не понимает, поэтому значения читаются
 * `getComputedStyle` с корня холста — палитра объявлена в `.root`
 * `FlatCanvas.module.css` (токены `--flat-*`) — и **перечитываются** при смене
 * темы: системной (`prefers-color-scheme`) и ручной (`html[data-theme]`).
 *
 * Палитра холста от темы интерфейса не зависит намеренно: силуэт лежит на
 * «бумаге», светлой в обеих темах, как поле печати, а обводки зон держат
 * контраст ≥ 3:1 и к бумаге, и к силуэту (сторож `flatCanvasCss.test.ts`).
 * Хук перечитывает токены всё равно: палитру можно будет развести по темам
 * правкой одного CSS, не трогая холст.
 *
 * `DEFAULT_TOKENS` — только для среды без CSS (jsdom, снимок до стилей) и
 * совпадают со значениями модуля; `coarse` — палец (`pointer: coarse`):
 * области попадания ручек ≥ 44 px.
 */
import { useEffect, useState, type RefObject } from 'react';

export interface CanvasTokens {
  /** Бумага под силуэтом */
  paper: string;
  /** Силуэт (перекраска `id="garment"`) */
  garment: string;
  /** Обводка зоны, рамка трансформера */
  zone: string;
  /** Safe-зона (пунктир) */
  safe: string;
  /** Ось изделия, центр рукава, именованные оси */
  axis: string;
  /** Горловина и низ рукава */
  neck: string;
  /** Отмер калибровки */
  calibrate: string;
  /** Подпись ручки */
  label: string;
  /** Подложка подписи и заливка ручки */
  halo: string;
}

export const TOKEN_NAMES: Record<keyof CanvasTokens, string> = {
  paper: '--flat-paper',
  garment: '--flat-garment',
  zone: '--flat-zone',
  safe: '--flat-safe',
  axis: '--flat-axis',
  neck: '--flat-neck',
  calibrate: '--flat-calibrate',
  label: '--flat-label',
  halo: '--flat-halo',
};

export const DEFAULT_TOKENS: CanvasTokens = {
  paper: '#FDFAF3',
  garment: '#d9d9d9',
  zone: '#2B2BF0',
  safe: '#067647',
  axis: '#6D28D9',
  neck: '#B42318',
  calibrate: '#B45309',
  label: '#0A0A0A',
  halo: '#ffffff',
};

export function readCanvasTokens(el: Element | null): CanvasTokens {
  if (!el || typeof getComputedStyle !== 'function') return DEFAULT_TOKENS;
  const style = getComputedStyle(el);
  const out = { ...DEFAULT_TOKENS };
  for (const key of Object.keys(TOKEN_NAMES) as (keyof CanvasTokens)[]) {
    const v = style.getPropertyValue(TOKEN_NAMES[key]).trim();
    if (v) out[key] = v;
  }
  return out;
}

const COARSE = '(pointer: coarse)';
const DARK = '(prefers-color-scheme: dark)';

const media = (q: string): MediaQueryList | null => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);
const same = (a: CanvasTokens, b: CanvasTokens) => (Object.keys(a) as (keyof CanvasTokens)[]).every((k) => a[k] === b[k]);

export function useCanvasTokens(ref: RefObject<Element | null>): { tokens: CanvasTokens; coarse: boolean } {
  const [tokens, setTokens] = useState<CanvasTokens>(DEFAULT_TOKENS);
  const [coarse, setCoarse] = useState(() => media(COARSE)?.matches ?? false);

  useEffect(() => {
    const read = () => {
      const next = readCanvasTokens(ref.current);
      setTokens((prev) => (same(prev, next) ? prev : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const dark = media(DARK);
    dark?.addEventListener('change', read);
    return () => {
      mo.disconnect();
      dark?.removeEventListener('change', read);
    };
  }, [ref]);

  useEffect(() => {
    const mql = media(COARSE);
    if (!mql) return undefined;
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return { tokens, coarse };
}
