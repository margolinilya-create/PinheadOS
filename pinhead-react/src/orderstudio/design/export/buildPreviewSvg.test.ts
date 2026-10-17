import { describe, it, expect } from 'vitest';
import { buildPreviewSvg, type PreviewInput } from './buildPreviewSvg';
import { area, frontView } from '../fixtures.testutil';
import type { Placement } from '../types';

const view = frontView({ print_areas: [area({ polygon_mm: [[100, 100], [400, 100], [400, 500], [100, 500]], safe_inset_mm: 0 })] });
const PNG = 'data:image/png;base64,AAAA';
const placement: Placement = {
  print_key: 'p1', view: 'front', area_id: 'chest', x_mm: 100, y_mm: 100, width_mm: 300, height_mm: 400,
  rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf', artwork_path: '', stale: false,
  asset: { type: 'png', source_file: 'l.png', intrinsic_w_mm: 1, intrinsic_h_mm: 1, size_estimated: false, has_preview: false },
};
const FLAT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760" width="600" height="760"><path id="garment" d="M0 0" fill="#111"/></svg>';
const input = (patch: Partial<PreviewInput> = {}): PreviewInput =>
  ({ view, flatMarkup: FLAT, flatMm: { w: 600, h: 760 }, placements: [placement], images: { p1: PNG }, ...patch });

describe('buildPreviewSvg (тесты DM)', () => {
  it('флэт-подложка + макет в мм, клип по зоне', () => {
    const svg = buildPreviewSvg(input());
    expect(svg).toContain('viewBox="0 0 600 760"');
    expect(svg).toContain('id="garment"');
    expect(svg).toMatch(/<image href="data:image\/png;base64,AAAA" x="100" y="100" width="300" height="400"/);
    expect(svg).toContain('clip-path="url(#pc-0)"');
  });

  it('перекраска флэта в цвет изделия', () => {
    expect(buildPreviewSvg(input({ garmentColor: '#3b4a6b', placements: [] }))).toContain('fill="#3b4a6b"');
  });

  it('снимок сцены — строка детерминирована', () => {
    expect(buildPreviewSvg(input({ placements: [{ ...placement, rotation_deg: 15, flip_h: true }] }))).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="600" height="760" viewBox="0 0 600 760"><defs><clipPath id="pc-0"><rect x="100" y="100" width="300" height="400"/></clipPath></defs><g transform="scale(1)"><path id="garment" d="M0 0" fill="#111"/></g><g clip-path="url(#pc-0)"><g transform="rotate(15 250 300) translate(250 300) scale(-1 1) translate(-250 -300)"><image href="data:image/png;base64,AAAA" x="100" y="100" width="300" height="400" preserveAspectRatio="none"/></g></g></svg>"`);
  });
});

describe('buildPreviewSvg — чужие данные (H1)', () => {
  it('картинка не data:image base64 — не ставится', () => {
    for (const href of ['http://evil.example/a.png', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/png;base64,AA" onload="x']) {
      expect(buildPreviewSvg(input({ images: { p1: href } }))).not.toContain('<image');
    }
  });

  it('не число в геометрии — исключение, а не NaN в атрибуте', () => {
    expect(() => buildPreviewSvg(input({ placements: [{ ...placement, x_mm: Number('x') }] }))).toThrow(/Не число/);
  });

  it('флэт со скриптом не проходит в превью', () => {
    const evil = FLAT.replace('<path ', '<script>alert(1)</script><path onclick="alert(2)" ');
    expect(buildPreviewSvg(input({ flatMarkup: evil }))).not.toMatch(/script|onclick|alert/);
  });

  it('цвет ткани с разметкой — нейтральный', () => {
    expect(buildPreviewSvg(input({ garmentColor: '"><script>', placements: [] }))).toContain('fill="#ccc"');
  });
});
