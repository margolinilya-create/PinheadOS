import { describe, expect, it } from 'vitest';
import { unaccountedBreakdown } from './stageGates';

/**
 * РАЗБИВКА «НЕ УЧТЕНО» ПО РАЗМЕРАМ (правка 28.09). Документ, п. 7:
 * «Показывать причину и размерную разбивку». Текст — тот же, что у сервера
 * (`erp_stage_unaccounted_by_size`): «M — 50 шт, L · чёрный — 44 шт».
 */
const cut = { id: 'cut', depends_on: [] as string[] };
const sew = { id: 'sew', depends_on: ['cut'] };
const report = (stage_id: string, sizes: { color?: string; size: string; qty_good?: number; qty_defect?: number }[]) => ({
  id: `${stage_id}-${sizes.length}`, stage_id, qty_defect: 0,
  sizes: sizes.map((s) => ({ color: s.color ?? '—', size: s.size, qty_good: s.qty_good ?? 0, qty_defect: s.qty_defect ?? 0 })),
});

describe('unaccountedBreakdown', () => {
  it('принято по размеру − сдано − брак, по размерам с остатком', () => {
    const reports = [
      report('cut', [{ size: 'M', qty_good: 60 }, { size: 'L', color: 'чёрный', qty_good: 44 }, { size: 'S', qty_good: 5 }]),
      report('sew', [{ size: 'M', qty_good: 8, qty_defect: 2 }, { size: 'S', qty_good: 5 }]),
    ];
    expect(unaccountedBreakdown(sew, [cut, sew], reports as never)).toBe('M — 50 шт, L · чёрный — 44 шт');
  });

  it('без размерных данных во всей цепочке — null, а не пустая строка', () => {
    expect(unaccountedBreakdown(sew, [cut, sew], [] as never)).toBeNull();
  });

  /** Проба на бою 28.09: сдачи без размеров — по размерам «не учтено» больше итога */
  it('разбивка, не сходящаяся с итогом, не показывается', () => {
    const reports = [report('cut', [{ size: 'M', qty_good: 60 }, { size: 'L', qty_good: 44 }])];
    expect(unaccountedBreakdown(sew, [cut, sew], reports as never, 104)).toBe('M — 60 шт, L — 44 шт');
    expect(unaccountedBreakdown(sew, [cut, sew], reports as never, 40)).toBeNull();
  });

  it('всё учтено — null', () => {
    const reports = [report('cut', [{ size: 'M', qty_good: 3 }]), report('sew', [{ size: 'M', qty_good: 3 }])];
    expect(unaccountedBreakdown(sew, [cut, sew], reports as never)).toBeNull();
  });
});
