/**
 * Силуэт вида для холста редактора флэта (веха 5б, задача 6а): очищенная
 * разметка черновика → картинка для konva.
 *
 * Разметка приходит уже очищенной (`readFlatSvg` или `resolveFlat`), но перед
 * показом проходит `sanitizeSvg` ещё раз — защита в глубину, как у холста 5а
 * (санитайзер идемпотентен, К3). Затем силуэт перекрашивается в цвет холста
 * (`recolorGarment`, только проверенный hex), уходит в Blob `image/svg+xml`
 * и показывается только как картинка — в DOM разметка не вставляется.
 *
 * Object URL живёт, пока живёт картинка: смена разметки или цвета и уход
 * с холста его освобождают (`revokeObjectURL`).
 *
 * `status`: `none` — разметки нет, `loading`, `ready`, `error` — разметка
 * не прошла санитайзер или картинка не открылась (холст пишет это текстом).
 */
import { useEffect, useMemo, useState } from 'react';
import { sanitizeSvg } from '../../../design/assets/sanitizeSvg';
import { recolorGarment } from '../../../design/export/flatMarkup';

export interface SvgImageState {
  status: 'none' | 'loading' | 'ready' | 'error';
  image: HTMLImageElement | null;
}

const NONE: SvgImageState = { status: 'none', image: null };

const ERROR: SvgImageState = { status: 'error', image: null };
const LOADING: SvgImageState = { status: 'loading', image: null };

export function useSvgImage(markup: string | null, garmentHex: string): SvgImageState {
  // Повторная очистка и перекраска — при рендере: эффект только грузит картинку
  const svg = useMemo(() => {
    if (!markup) return null;
    const clean = sanitizeSvg(markup);
    return clean.ok ? recolorGarment(clean.svg, garmentHex) : '';
  }, [markup, garmentHex]);
  const [loaded, setLoaded] = useState<{ svg: string; state: SvgImageState }>({ svg: '', state: NONE });

  useEffect(() => {
    if (!svg) return undefined;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setLoaded({ svg, state: { status: 'ready', image: img } });
    };
    img.onerror = () => {
      if (active) setLoaded({ svg, state: ERROR });
    };
    img.src = url;
    return () => {
      active = false;
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [svg]);

  if (svg === null) return NONE;
  if (svg === '') return ERROR;
  return loaded.svg === svg ? loaded.state : LOADING;
}
