/**
 * Цвета холста из токенов (веха 5а, задача 6а; проверка скиллами: «цвета Konva —
 * из токенов через `getComputedStyle`, две темы»). Konva рисует в `<canvas>` и
 * CSS-переменных не понимает, поэтому значения читаются с контейнера холста
 * (палитра оболочки `.shell` переопределяет токены — читать с `:root` нельзя)
 * и перечитываются при смене темы (`html[data-theme]`).
 *
 * Значения по умолчанию — только для среды без CSS (jsdom, снимок до стилей):
 * пустой токен заменяется светлой палитрой `index.css`, чтобы холст не рисовал
 * прозрачным.
 *
 * `coarse` — палец (`pointer: coarse`): ручки трансформера ≥ 24 px и толще
 * зона попадания (проверка скиллами, тач).
 */
import { useEffect, useState, type RefObject } from 'react';

export interface CanvasColors {
  /** Выбор, обводка зоны на светлой ткани, плашка размера */
  accent: string;
  /** Безопасная зона */
  safe: string;
  /** Выход за зону, отрицательный отступ */
  danger: string;
  /** Гайды привязки */
  guide: string;
  /** Размерные линии */
  dim: string;
  /** Именованные оси изделия */
  axis: string;
  /** Подложка подписи */
  halo: string;
  /** Текст подписи */
  text: string;
  /** Текст на плашке акцента */
  onAccent: string;
}

const TOKENS: Record<keyof CanvasColors, string> = {
  accent: '--accent',
  safe: '--color-success',
  danger: '--color-error',
  guide: '--color-warning',
  dim: '--text-mid',
  axis: '--color-violet',
  halo: '--card',
  text: '--text',
  onAccent: '--btn-primary-fg',
};

export const DEFAULT_COLORS: CanvasColors = {
  accent: '#2B2BF0',
  safe: '#06a77d',
  danger: '#e63946',
  guide: '#c87137',
  dim: '#555555',
  axis: '#8B5CF6',
  halo: '#ffffff',
  text: '#0A0A0A',
  onAccent: '#ffffff',
};

export function readCanvasColors(el: Element | null): CanvasColors {
  if (!el || typeof getComputedStyle !== 'function') return DEFAULT_COLORS;
  const style = getComputedStyle(el);
  const out = { ...DEFAULT_COLORS };
  for (const key of Object.keys(TOKENS) as (keyof CanvasColors)[]) {
    const v = style.getPropertyValue(TOKENS[key]).trim();
    if (v) out[key] = v;
  }
  return out;
}

const COARSE = '(pointer: coarse)';

function isCoarse(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(COARSE).matches;
}

export function useCanvasTheme(ref: RefObject<Element | null>): { colors: CanvasColors; coarse: boolean } {
  const [colors, setColors] = useState<CanvasColors>(DEFAULT_COLORS);
  const [coarse, setCoarse] = useState(isCoarse);

  useEffect(() => {
    const read = () => setColors(readCanvasColors(ref.current));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, [ref]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(COARSE);
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return { colors, coarse };
}
