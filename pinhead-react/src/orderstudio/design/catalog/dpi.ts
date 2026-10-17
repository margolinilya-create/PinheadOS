// Качество печати макета на текущем размере. Перенос DM `lib/catalog/dpi.ts`.
// Пороги — из профиля техники (`model/printMethods`, задача 1; ответ владельца
// 17.10: DTF, шелкография, DTG и флекс — 300 / 150), вышивка — по детали.
// SVG — вектор. Предупреждаем, не блокируем.
import type { AssetMeta, MethodProfileLike } from '../types';

/** Пороги, когда у профиля техники их нет */
export const DPI_GOOD = 300;
export const DPI_MIN = 150;

export type PrintQuality = 'vector' | 'good' | 'mid' | 'low' | 'embroidery' | 'unknown';

/** Эффективный DPI: пиксели исходника на ширину печати (мм) */
export function effectiveDpi(pxWidth: number, printWidthMm: number): number {
  if (!(pxWidth > 0) || !(printWidthMm > 0)) return 0;
  return (pxWidth * 25.4) / printWidthMm;
}

export interface QualityInfo {
  quality: PrintQuality;
  dpi?: number;
}

/** Качество печати макета при ширине печати (мм) для профиля техники */
export function printQuality(
  asset: Pick<AssetMeta, 'type' | 'px_w'> | undefined,
  printWidthMm: number,
  profile?: Pick<MethodProfileLike, 'dpi' | 'detail'>,
): QualityInfo {
  if (!asset) return { quality: 'unknown' };
  if (profile?.detail) return { quality: 'embroidery' };
  if (asset.type === 'svg') return { quality: 'vector' };
  if (!asset.px_w) return { quality: 'unknown' };
  const dpi = effectiveDpi(asset.px_w, printWidthMm);
  const { good, min } = profile?.dpi ?? { good: DPI_GOOD, min: DPI_MIN };
  return { quality: dpi >= good ? 'good' : dpi >= min ? 'mid' : 'low', dpi };
}
