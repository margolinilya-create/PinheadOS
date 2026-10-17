import { describe, it, expect } from 'vitest';
import { preflight, type PreflightInput } from './preflight';
import { area, flat, frontView } from '../fixtures.testutil';
import type { AssetMeta, GarmentFlat, Placement, PrintArea, ProfileOf } from '../types';
import type { SalesPrintMethod } from '../../model/types';

/** Профили как у `model/printMethods` (задача 1): растровые 300/150, вышивка — деталь */
const profileOf: ProfileOf = (m) => m === 'embroidery'
  ? { id: m, label: 'Вышивка', colorMode: 'spot', detail: { minLineMm: 1, minTextMm: 4 } }
  : { id: m, label: m === 'dtf' ? 'DTF' : 'Шелкография', colorMode: m === 'dtf' ? 'cmyk' : 'spot', dpi: { good: 300, min: 150 } };
const anyMethod = () => true;
/** Как `allowedMethods(area, rules).includes(m)`: методы зоны, пусто — все */
const byArea = (a: PrintArea, m: SalesPrintMethod) => !a.methods?.length || a.methods.includes(m);

const goodPng: AssetMeta = {
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 100,
  px_w: 1500, px_h: 1500, size_estimated: false, has_preview: false,
};
const pl = (patch: Partial<Placement> = {}): Placement => ({
  print_key: 'p1', view: 'front', area_id: 'chest', x_mm: 200, y_mm: 200, width_mm: 100, height_mm: 100,
  rotation_deg: 0, flip_h: false, flip_v: false, method: 'dtf', asset: goodPng, artwork_path: '', stale: false,
  ...patch,
});
const withArea = (patch: Partial<PrintArea>): GarmentFlat => flat({ views: [frontView({ print_areas: [area(patch)] })] });
const run = (patch: Partial<PreflightInput> = {}) =>
  preflight({ flat: flat(), placements: [pl()], profileOf, methodAllowed: anyMethod, ...patch });
const has = (issues: ReturnType<typeof preflight>, text: string) => issues.some((i) => i.message.includes(text));

describe('preflight', () => {
  it('нет нанесений — серьёзное, но не блок', () => {
    expect(run({ placements: [] })).toEqual([{ level: 'serious', message: 'На изделии нет нанесений — PDF будет без макета.' }]);
  });

  it('чистый случай — без замечаний', () => {
    expect(run()).toEqual([]);
  });

  it('DPI: ниже 150 — серьёзное, 150–299 — предупреждение', () => {
    const low = run({ placements: [pl({ asset: { ...goodPng, px_w: 300 } })] });
    expect(low[0]).toMatchObject({ level: 'serious', printKey: 'p1' });
    expect(low[0].message).toContain('«Грудь»: разрешение 76 DPI для «DTF»');
    const mid = run({ placements: [pl({ asset: { ...goodPng, px_w: 800 } })] });
    expect(mid[0].level).toBe('warn');
    expect(has(mid, 'лучше от 300')).toBe(true);
  });

  it('вышивка — подсказка о детали, а не DPI', () => {
    const r = run({ placements: [pl({ method: 'embroidery', asset: { ...goodPng, px_w: 100 } })] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ level: 'info' });
    expect(r[0].message).toContain('тоньше 1 мм');
  });

  it('выход за зону', () => {
    expect(has(run({ placements: [pl({ x_mm: 160, width_mm: 400 })] }), 'выходит за печатную зону')).toBe(true);
  });

  it('максимум зоны — с поворотом, минимум — по сырым Ш×В', () => {
    const maxed = withArea({ max_print_mm: { width: 200, height: 200 } });
    expect(has(run({ flat: maxed, placements: [pl({ width_mm: 180, height_mm: 180, rotation_deg: 45 })] }), 'больше максимума')).toBe(true);
    expect(has(run({ flat: maxed, placements: [pl({ width_mm: 180, height_mm: 180 })] }), 'больше максимума')).toBe(false);
    const mined = withArea({ min_print_mm: { width: 50, height: 50 } });
    expect(has(run({ flat: mined, placements: [pl({ width_mm: 30, height_mm: 30, rotation_deg: 45 })] }), 'меньше минимума')).toBe(true);
  });

  it('техника не для зоны — предупреждение; допустимая — нет', () => {
    const dtfOnly = withArea({ methods: ['dtf'] });
    expect(has(run({ flat: dtfOnly, methodAllowed: byArea, placements: [pl({ method: 'silkscreen' })] }), 'не для этой зоны')).toBe(true);
    expect(has(run({ flat: dtfOnly, methodAllowed: byArea }), 'не для этой зоны')).toBe(false);
  });

  it('оценочный размер и обновлённый силуэт', () => {
    expect(has(run({ placements: [pl({ asset: { ...goodPng, size_estimated: true } })] }), 'размер файла оценочный')).toBe(true);
    expect(has(run({ placements: [pl({ stale: true })] }), 'силуэт обновлён')).toBe(true);
  });

  it('зона не найдена — серьёзное', () => {
    expect(run({ placements: [pl({ area_id: 'nope' })] })[0].level).toBe('serious');
  });

  it('серьёзные впереди, всё — без блокирующего уровня', () => {
    const r = run({ placements: [pl({ x_mm: 160, width_mm: 400, asset: { ...goodPng, px_w: 100 } })] });
    expect(r.map((i) => i.level)).toEqual(['serious', 'warn']);
    expect(r.every((i) => ['serious', 'warn', 'info'].includes(i.level))).toBe(true);
  });
});
