import { describe, it, expect } from 'vitest';
import { isLightFabric, statsOfPixels } from './artStats';

/** Картинка w×h: фон `bg`, квадрат по центру цвета `fg` (RGBA) */
function img(w: number, h: number, bg: number[], fg: number[], extra?: (x: number, y: number) => number[] | null) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inner = x > w / 4 && x < (3 * w) / 4 && y > h / 4 && y < (3 * h) / 4;
      const c = extra?.(x, y) ?? (inner ? fg : bg);
      d.set(c, (y * w + x) * 4);
    }
  }
  return d;
}

describe('statsOfPixels — что в макете клиента (веха 5в, Э3)', () => {
  it('PNG с прозрачным фоном — прозрачность есть, фон не «непрозрачный», 1 цвет', () => {
    const s = statsOfPixels(img(40, 40, [0, 0, 0, 0], [200, 10, 10, 255]), 40, 40);
    expect(s).toEqual({ transparent: true, opaqueBackground: false, colors: 1 });
  });
  it('JPEG-логотип на белом прямоугольнике — непрозрачный фон, 2 цвета', () => {
    const s = statsOfPixels(img(40, 40, [255, 255, 255, 255], [10, 10, 200, 255]), 40, 40);
    expect(s).toEqual({ transparent: false, opaqueBackground: true, colors: 2 });
  });
  it('фото на всю площадь (углы разные) — не «фон»; цветов много', () => {
    const s = statsOfPixels(img(64, 64, [0, 0, 0, 255], [0, 0, 0, 255], (x, y) => [x * 4, y * 4, (x + y) * 2, 255]), 64, 64);
    expect(s.opaqueBackground).toBe(false);
    expect(s.colors).toBeGreaterThanOrEqual(16);
  });
  it('сглаживание краёв (единичные пиксели) цветом не считается', () => {
    const s = statsOfPixels(img(100, 100, [0, 0, 0, 0], [200, 10, 10, 255], (x, y) => (x === 30 && y === 30 ? [90, 90, 90, 255] : null)), 100, 100);
    expect(s.colors).toBe(1);
  });
});

describe('isLightFabric', () => {
  it('белая и молочная — светлые; чёрная, синяя — нет; нет цвета — светлая', () => {
    expect(isLightFabric('#ffffff')).toBe(true);
    expect(isLightFabric('#f3eee2')).toBe(true);
    expect(isLightFabric('#111111')).toBe(false);
    expect(isLightFabric('#1e3a8a')).toBe(false);
    expect(isLightFabric(null)).toBe(true);
  });
});

