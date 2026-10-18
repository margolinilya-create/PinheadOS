import { describe, expect, it } from 'vitest';
import { reportTotals } from './reportTotals';

/**
 * ЧИСЛА ОТЧЁТА ЦЕХА — правило одно с `erp_stage_submit_report`: разбивка
 * (рулоны → размеры → скаляры) задаёт числа, когда она есть. Утилита
 * вынесена из `stagesSlice` (27.09), тест держит правило на месте.
 */
const size = (qty_good: number, extra: Partial<{ qty_defect: number; qty_rework: number; qty_extra: number; size: string }> = {}) =>
  ({ color: '—', size: 'M', qty_good, ...extra });

describe('reportTotals', () => {
  it('без разбивки берёт скаляры, отрицательные срезает в ноль', () => {
    expect(reportTotals({ qtyGood: 5, qtyDefect: -2, qtyRework: 1 }))
      .toMatchObject({ good: 5, defect: 0, rework: 1, extraQty: 0, sizes: [], rolls: [] });
  });

  it('размеры задают все четыре числа, скаляры игнорируются', () => {
    const r = reportTotals({
      qtyGood: 100,
      sizes: [size(3, { qty_defect: 1 }), size(4, { size: 'L', qty_rework: 2, qty_extra: 1 })],
    });
    expect(r).toMatchObject({ good: 7, defect: 1, rework: 2, extraQty: 1 });
  });

  it('строка без размера отбрасывается, рулон без id — тоже', () => {
    const r = reportTotals({
      sizes: [size(3), { color: '—', size: '', qty_good: 9 }],
      rolls: [{ roll_id: 'r1', sizes: [size(2)] }, { roll_id: '', sizes: [size(50)] }],
    });
    expect(r.sizes).toHaveLength(1);
    expect(r.rolls).toHaveLength(1);
    expect(r.good).toBe(2);
  });

  /**
   * Закрой: размерные строки несут только годные, брак — скаляр формы.
   * Прежде брак брался из строк и терялся (правка 28.09): форма требовала
   * комментарий к браку, а на сервер уходил 0.
   */
  it('рулоны задают годное, брак и переделка — скаляры формы, как у сервера', () => {
    const r = reportTotals({
      qtyDefect: 3,
      qtyRework: 1,
      sizes: [size(6), size(4, { size: 'L' })],
      rolls: [{ roll_id: 'r1', sizes: [size(6)] }, { roll_id: 'r2', sizes: [size(4)] }],
    });
    expect(r).toMatchObject({ good: 10, defect: 3, rework: 1 });
  });

  /**
   * Закрой с правки 19.10: выпуск вводится один раз таблицей, рулоны несут
   * только расход (без размеров). Годные — сумма таблицы, брак — скаляр формы;
   * зеркало новой ветки `erp_stage_submit_report`.
   */
  it('режим рулонов: good — сумма таблицы выпуска', () => {
    const r = reportTotals({
      qtyGood: 999,
      qtyDefect: 2,
      sizes: [size(60), size(40, { size: 'L', qty_defect: 7 })],
      rolls: [{ roll_id: 'r1' }, { roll_id: 'r2', sizes: [] }],
    });
    expect(r).toMatchObject({ good: 100, defect: 2, rework: 0 });
    expect(r.rolls).toHaveLength(2);
  });

  /**
   * Р7 «Сдать без списания» (ревизия A4): закрой шлёт строки выпуска без
   * рулонов, и строки несут одно `qty_good`. Брак, переделка и плюс — скаляры
   * формы; строки швейки (все три числа) по-прежнему задают их сами.
   */
  it('закрой без рулонов: брак, переделка и плюс — скаляры, если строки их не несут', () => {
    const r = reportTotals({
      qtyGood: 999, qtyDefect: 2, qtyRework: 1, qtyExtra: 3,
      sizes: [size(40), size(60, { size: 'L' })],
      rolls: [],
    });
    expect(r).toMatchObject({ good: 100, defect: 2, rework: 1, extraQty: 3 });
  });

  it('швейка: строки с браком задают его, даже нулём, скаляр игнорируется', () => {
    const r = reportTotals({
      qtyDefect: 5,
      sizes: [size(10, { qty_defect: 0, qty_rework: 0 })],
    });
    expect(r).toMatchObject({ good: 10, defect: 0, rework: 0 });
  });
});
