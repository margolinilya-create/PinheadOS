/**
 * Что видно в макете клиента (веха 5в, Э3): прозрачность, непрозрачный фон,
 * число цветов. Считается на лету из уже загруженной картинки холста —
 * **в раскладку не пишется** (`layout` — только геометрия, правило 5а).
 *
 * - прозрачность — доля пикселей с альфой < 16 от 1 %;
 * - непрозрачный фон — прозрачности нет, а четыре угла одного цвета
 *   (логотип на белом прямоугольнике: DTF напечатает прямоугольник);
 * - цвета — кванты 4 бита на канал среди непрозрачных пикселей с долей от
 *   0,5 % (сглаживание краёв мелкими долями не считается); крупные кванты
 *   покрывают меньше 80 % — это фото или градиент: «полноцвет» (`FULL_COLOR`).
 */
export interface ArtStats {
  transparent: boolean;
  opaqueBackground: boolean;
  /** Цветов в макете (оценка) */
  colors: number;
}

/** Сторона уменьшенной копии для подсчёта, px */
export const STATS_PX = 160;
const TRANSPARENT_SHARE = 0.01;
const COLOR_SHARE = 0.005;
const COVERED_SHARE = 0.8;
/** Полноцветный макет (фото, градиент) — цветов не меньше этого */
export const FULL_COLOR = 16;

export function statsOfPixels(data: Uint8ClampedArray, w: number, h: number): ArtStats {
  const total = w * h;
  let clear = 0;
  const buckets = new Map<number, number>();
  let opaque = 0;
  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3];
    if (a < 16) { clear++; continue; }
    if (a < 128) continue;
    opaque++;
    const key = ((data[i * 4] >> 4) << 8) | ((data[i * 4 + 1] >> 4) << 4) | (data[i * 4 + 2] >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const transparent = total > 0 && clear / total >= TRANSPARENT_SHARE;
  const px = (x: number, y: number) => data.slice((y * w + x) * 4, (y * w + x) * 4 + 4);
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  const same = corners.every((c) => c[3] >= 240 && [0, 1, 2].every((k) => Math.abs(c[k] - corners[0][k]) <= 24));
  const big = opaque ? [...buckets.values()].filter((n) => n / opaque >= COLOR_SHARE) : [];
  const covered = opaque ? big.reduce((a, n) => a + n, 0) / opaque : 1;
  const colors = covered < COVERED_SHARE ? Math.max(big.length, FULL_COLOR) : big.length;
  return { transparent, opaqueBackground: !transparent && same, colors };
}

const cache = new WeakMap<HTMLImageElement, ArtStats | null>();

/** Статистика картинки холста; без 2D-контекста (тесты, старый браузер) — `null` */
export function artStatsOf(img: HTMLImageElement | null): ArtStats | null {
  if (!img?.naturalWidth || !img?.naturalHeight) return null;
  if (cache.has(img)) return cache.get(img) ?? null;
  let out: ArtStats | null = null;
  try {
    const k = Math.min(1, STATS_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (g) {
      g.drawImage(img, 0, 0, w, h);
      out = statsOfPixels(g.getImageData(0, 0, w, h).data, w, h);
    }
  } catch {
    out = null;
  }
  cache.set(img, out);
  return out;
}

/** Светлая ткань (белая, молочная): яркость от 0,85 — DTG по ней фон не печатает */
export function isLightFabric(hex: string | null | undefined): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return true;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number.parseInt(x, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.85;
}
