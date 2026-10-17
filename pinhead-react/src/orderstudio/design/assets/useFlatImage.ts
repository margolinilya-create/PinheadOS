/**
 * Флэт вида для холста в цвете ткани (веха 5а, задача 5) — React-обёртка над
 * кэшем `flatImages` (скачивание, санитайзер, перекраска, object URL).
 *
 * `status`: `none` — у флэта нет такого вида (или флэта нет), `loading`,
 * `ready` — `image` и `flatMm` (габарит, мм) есть, `error` — не вышло
 * (тост уже показан, один на путь).
 */
import { useEffect, useState } from 'react';
import type { DesignView, GarmentFlat } from '../types';
import { loadFlatImage, type FlatImage } from './flatImages';

export interface FlatImageState {
  status: 'none' | 'loading' | 'ready' | 'error';
  image: HTMLImageElement | null;
  flatMm: { w: number; h: number } | null;
}

export function useFlatImage(flat: GarmentFlat | null | undefined, view: DesignView, colorHex: string): FlatImageState {
  const v = flat?.views.find((x) => x.kind === view);
  const svgPath = v?.svg_path ?? '';
  const scale = v?.scale_mm_per_unit ?? 0;
  const key = svgPath ? `${svgPath}|${scale}|${colorHex}` : '';
  const [loaded, setLoaded] = useState<{ key: string; res: FlatImage | null }>({ key: '', res: null });

  useEffect(() => {
    if (!svgPath) return undefined;
    let active = true;
    void loadFlatImage({ svg_path: svgPath, scale_mm_per_unit: scale }, colorHex).then((res) => {
      if (active) setLoaded({ key: `${svgPath}|${scale}|${colorHex}`, res });
    });
    return () => { active = false; };
  }, [svgPath, scale, colorHex]);

  if (!key) return { status: 'none', image: null, flatMm: null };
  if (loaded.key !== key) return { status: 'loading', image: null, flatMm: null };
  return loaded.res
    ? { status: 'ready', image: loaded.res.image, flatMm: loaded.res.flatMm }
    : { status: 'error', image: null, flatMm: null };
}
