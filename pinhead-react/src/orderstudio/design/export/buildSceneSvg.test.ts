import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildSceneSvg, mockupSceneMm, PDF_FONT_FAMILY, TYPICAL_FLAT_NOTE, type SceneInput } from './buildSceneSvg';
import { goldenScene } from './sceneGolden.testutil';
import { sanitizeSvg } from '../assets/sanitizeSvg';
import { frontView } from '../fixtures.testutil';
import type { Placement, ProfileOf } from '../types';

const view = frontView();
const PNG = 'data:image/png;base64,AAAA';
const FLAT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760" width="600" height="760"></svg>';

const placement = (patch: Partial<Placement> = {}): Placement => ({
  print_key: 'p1', view: 'front', area_id: 'chest', x_mm: 250, y_mm: 167, width_mm: 100, height_mm: 100,
  rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf', artwork_path: '', stale: false,
  asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 100, size_estimated: false, has_preview: false },
  ...patch,
});

const profileOf: ProfileOf = (m) => ({ id: m, label: m, colorMode: m === 'silkscreen' ? 'spot' : 'cmyk' });

// Раскладка листа (мм): PAD 14, HEADER_H 32, SIZE_H 42.
// Флэт 600×760: W = 14+600+14 = 628; H = 32+760+42+14 = 848.
function scene(patch: Partial<SceneInput> = {}): string {
  return buildSceneSvg({
    view,
    flatMarkup: FLAT,
    flatMm: { w: 600, h: 760 },
    placements: [placement()],
    images: { p1: PNG },
    meta: { client: 'К', orderNumber: 'PH-0001', itemTitle: 'Футболка Regular', size: 'M', date: '17.10.2026' },
    profileOf,
    ...patch,
  });
}

describe('buildSceneSvg — лист макета (тесты DM)', () => {
  it('страница в мм (1:1): шапка + рисунок + блок размера', () => {
    const svg = scene();
    expect(svg).toMatch(/width="628mm"/);
    expect(svg).toMatch(/height="848mm"/);
    expect(svg).toMatch(/viewBox="0 0 628 848"/);
  });

  it('scale_mm_per_unit масштабирует флэт', () => {
    const svg = scene({
      view: { ...view, scale_mm_per_unit: 0.5 },
      flatMarkup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1200"><path id="garment" d="M0 0"/></svg>',
      flatMm: { w: 500, h: 600 },
      placements: [],
    });
    expect(svg).toContain('transform="scale(0.5)"');
    expect(svg).toMatch(/width="528mm"/);
  });

  it('шапка: клиент, № заказа, дата, позиция, статус', () => {
    const svg = scene({ meta: { client: 'К', orderNumber: 'PH-0001', itemTitle: 'Футболка Regular', size: 'M', date: '17.10.2026', statusLabel: 'Расчёт' } });
    expect(svg).toContain('data-order-header="1"');
    expect(svg).toContain('Клиент: К · Заказ №: PH-0001 · 17.10.2026');
    expect(svg).toContain('Футболка Regular');
    expect(svg).toContain('Расчёт');
  });

  it('пустые клиент и номер — прочерки', () => {
    expect(scene({ meta: { client: '', orderNumber: '', itemTitle: '', size: 'M', date: '17.10.2026' } }))
      .toContain('Клиент: — · Заказ №: — · 17.10.2026');
  });

  it('типовой силуэт — пометка в шапке', () => {
    expect(scene()).not.toContain(TYPICAL_FLAT_NOTE);
    expect(scene({ meta: { client: '', orderNumber: '', itemTitle: '', size: 'M', date: '', typicalFlat: true } })).toContain(TYPICAL_FLAT_NOTE);
  });

  it('слои: garment / production-artwork / markup; техника и режим цвета', () => {
    const svg = scene({ placements: [placement({ method: 'silkscreen' })] });
    expect(svg).toContain('data-layer="garment"');
    expect(svg).toContain('data-layer="production-artwork"');
    expect(svg).toContain('data-layer="markup"');
    expect(svg).toContain('data-method="silkscreen"');
    expect(svg).toContain('data-color-mode="spot"');
  });

  it('на нанесение — отступ от горловины и плашка Ш×В', () => {
    const svg = scene();
    expect(svg).toContain('>75<');
    expect(svg).toContain('100×100 мм');
  });

  it('метка размера: буква — кегль 34, ONE SIZE — 20', () => {
    expect(scene()).toMatch(/font-size="34"[^>]*>M<\/text>/);
    const one = scene({ meta: { client: '', orderNumber: '', itemTitle: '', size: 'ONE SIZE', date: '' } });
    expect(one).toContain('data-size-label="ONE SIZE"');
    expect(one).toMatch(/font-size="20"[^>]*>ONE SIZE<\/text>/);
  });

  it('калибровочная шкала ровно 100 мм', () => {
    const svg = scene();
    expect(svg).toContain('data-calibration-mm="100"');
    const m = svg.match(/<line x1="([\d.]+)" y1="[\d.]+" x2="([\d.]+)" y2="[\d.]+" stroke="#4b5563" stroke-width="0.75"\/>/);
    expect(parseFloat(m![2]) - parseFloat(m![1])).toBeCloseTo(100, 6);
  });

  it('шрифт листа — кириллический', () => {
    expect(scene()).toContain(`font-family="${PDF_FONT_FAMILY}`);
  });

  it('шоппер без горловины: отступ от верха зоны (140): y=167 → 27', () => {
    expect(scene({ view: { ...view, anchors: { center_axis_x: 300 } } })).toContain('>27<');
  });

  it('своя сцена проходит санитайзер без потерь (белый список покрывает лист)', () => {
    const svg = scene({ meta: { client: 'К', orderNumber: '1', itemTitle: 'x', size: 'M', date: 'd', statusLabel: 'Расчёт', typicalFlat: true } });
    const again = sanitizeSvg(svg, 'scene');
    expect(again.ok && again.removed).toEqual([]);
  });
});

describe('buildSceneSvg — легенда и пометки PDF макета (задача 7)', () => {
  const META = { client: 'К', orderNumber: 'PH-0001', itemTitle: 'Футболка', size: 'M', date: '17.10.2026' };

  it('легенда: номер нанесения и строка внизу листа; номер — и на плашке Ш×В', () => {
    const svg = scene({ legend: [{ printKey: 'p1', n: 2, text: 'Грудь (перед) — DTF, 100×100 мм' }] });
    expect(svg).toContain('data-legend="1"');
    expect(svg).toContain('>2. Грудь (перед) — DTF, 100×100 мм<');
    expect(svg).toContain('>2 · 100×100 мм<');
  });

  it('без легенды плашка — как прежде, без номера', () => {
    expect(scene()).toContain('>100×100 мм<');
    expect(scene()).not.toContain('data-legend');
  });

  it('до четырёх строк лист не растёт; больше — удлиняется, а не налезает на шкалу', () => {
    const rows = (k: number) => Array.from({ length: k }, (_, i) => ({ printKey: `k${i}`, n: i + 1, text: 'Спина — DTF' }));
    expect(scene({ legend: rows(4) })).toMatch(/height="848mm"/);
    // 32 + 760 + (10 + 8 × 7 + 4) + 14 = 876
    expect(scene({ legend: rows(8) })).toMatch(/height="876mm"/);
  });

  it('длинная строка легенды обрезается многоточием до середины листа', () => {
    const svg = scene({ legend: [{ printKey: 'p1', n: 1, text: 'Ж'.repeat(400) }] });
    const row = svg.match(/data-legend="1">(<text[^>]*>)([^<]*)</)![2];
    expect(row.endsWith('…')).toBe(true);
    expect(row.length).toBeLessThan(120);
  });

  it('пометки шапки: типовой силуэт и растр логотипа — одной строкой', () => {
    const svg = scene({ meta: { ...META, typicalFlat: true, notes: ['логотип 2 — растр'] } });
    expect(svg).toContain(`${TYPICAL_FLAT_NOTE} · логотип 2 — растр`);
    expect(scene({ meta: { ...META, notes: ['логотип 1 — растр из PDF'] } })).toContain('>логотип 1 — растр из PDF<');
  });

  it('жирный — словом bold: у шрифта PDF два начертания, «800» svg2pdf не нашёл бы', () => {
    expect(scene()).not.toMatch(/font-weight="(?!bold")/);
  });

  it('легенда и пометки с разметкой остаются текстом (H1), сцена проходит санитайзер без потерь', () => {
    const svg = scene({
      legend: [{ printKey: 'p1', n: 1, text: '</text><script>alert(1)</script>' }],
      meta: { ...META, notes: ['"><image href=x onerror=alert(1)>'] },
    });
    expect(svg).not.toMatch(/<script|onerror="/);
    const again = sanitizeSvg(svg, 'scene');
    expect(again.ok && again.removed).toEqual([]);
  });
});

describe('buildSceneSvg — чужие данные (H1)', () => {
  it('клиент с разметкой остаётся текстом', () => {
    const evil = '"><image href=x onerror=alert(1)>';
    const svg = scene({ meta: { client: evil, orderNumber: '<script>', itemTitle: '</text><script>', size: '"M', date: '' } });
    expect(svg).not.toMatch(/<image href=x|<script|onerror="/);
    expect(svg).toContain('&lt;image href=x onerror=alert(1)&gt;');
    expect(svg).toContain('&lt;script&gt;');
    expect((svg.match(/<image /g) ?? []).length).toBe(1);
  });

  it("клиент с $' и $& остаётся текстом: шаблоны замены строки не срабатывают", () => {
    const client = "A$'B$&C$$D$`E";
    const svg = scene({ meta: { client, orderNumber: 'N$$1', itemTitle: "$'", size: 'M', date: '', notes: ['$&'] } });
    expect(svg).toContain("A$'B$&amp;C$$D$`E");
    expect(svg).toContain('N$$1');
    expect(svg).not.toContain('@@BG@@');
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    const again = sanitizeSvg(svg, 'scene');
    expect(again.ok && again.removed).toEqual([]);
  });

  it('строка вместо числа в раскладке — исключение, а не атрибут', () => {
    const bad = placement({ y_mm: '"><script>' as unknown as number });
    expect(() => scene({ placements: [bad] })).toThrow();
  });

  it('картинка не data:image base64 — не ставится', () => {
    expect(scene({ images: { p1: 'http://evil.example/a.png' } })).not.toContain('<image');
  });

  it('вредный флэт вычищен', () => {
    const evil = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><foreignObject><b>x</b></foreignObject><g id="garment" onload="alert(1)"/></svg>';
    expect(scene({ flatMarkup: evil })).not.toMatch(/foreignObject|onload|alert/);
  });
});

describe('buildSceneSvg — мокап ТЗ: outputScale и выделение (веха 6+7, задача 3, К6)', () => {
  /** 7 pt в мм — меньше цех не читает; линия — не тоньше 0,25 мм */
  const MIN_FONT_MM = (7 * 25.4) / 72;
  const MIN_LINE_MM = 0.25;
  const markupLayer = (svg: string) => svg.match(/data-layer="markup">([\s\S]*?)<\/g><\/g>/)?.[1] ?? '';
  const nums = (s: string, attr: string) => [...s.matchAll(new RegExp(`${attr}="([\\d.]+)"`, 'g'))].map((m) => parseFloat(m[1]));

  it('по умолчанию лист макета 5а побайтно прежний (sha-256 до правки) и равен outputScale = 1', () => {
    const svg = goldenScene();
    expect(createHash('sha256').update(svg).digest('hex')).toBe('3318d9d90ec8707219c87e6105990edbf0b9e3a8a124dceb73995fd286596a1c');
    expect(goldenScene({ outputScale: 1 })).toBe(svg);
  });

  it('мокап: без шапки, шкалы «1:1» и метки размера; лист — флэт с полями', () => {
    const svg = goldenScene({ outputScale: 0.18, legend: [] });
    expect(svg).not.toContain('data-order-header');
    expect(svg).not.toContain('data-calibration-mm');
    expect(svg).not.toContain('масштаб 1:1');
    expect(svg).not.toContain('data-size-label');
    expect(mockupSceneMm({ w: 600, h: 760 })).toEqual({ w: 628, h: 788 });
    expect(svg).toMatch(/width="628mm"/);
    expect(svg).toMatch(/height="788mm"/);
  });

  it('подписи и линии разметки в PDF не мельче 7 pt и 0,25 мм при любом масштабе', () => {
    for (const s of [0.1, 0.18, 0.3]) {
      const marks = markupLayer(goldenScene({ outputScale: s, legend: [] }));
      const fonts = nums(marks, 'font-size');
      const lines = nums(marks, 'stroke-width');
      expect(fonts.length).toBeGreaterThan(0);
      expect(lines.length).toBeGreaterThan(0);
      for (const f of fonts) expect(f * s).toBeGreaterThanOrEqual(MIN_FONT_MM - 1e-6);
      for (const w of lines) expect(w * s).toBeGreaterThanOrEqual(MIN_LINE_MM - 1e-6);
    }
  });

  it('выделение: разметка (отступ и плашка) — только у текущего нанесения, рисунки — у всех', () => {
    const images = { a: 'data:image/png;base64,AAAA', b: 'data:image/png;base64,BBBB' };
    const svg = goldenScene({ outputScale: 0.2, legend: [], images, highlight: 'b' });
    expect((svg.match(/<image /g) ?? []).length).toBe(2);
    expect((markupLayer(svg).match(/100×80 мм/g) ?? []).length).toBe(1);
    expect(svg).toContain('data-highlight="b"');
  });

  it('мокап проходит санитайзер без потерь', () => {
    const again = sanitizeSvg(goldenScene({ outputScale: 0.2, legend: [], highlight: 'a' }), 'scene');
    expect(again.ok && again.removed).toEqual([]);
  });
});
