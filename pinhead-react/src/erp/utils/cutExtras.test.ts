import { describe, expect, it } from 'vitest';
import { cutExtras, cutExtrasText, reportedSizesOf } from './cutExtras';
import { cellKey } from './cutRolls';

/**
 * Ключ ячейки строится ФУНКЦИЕЙ, а не литералом: разделителем в нём стоит
 * нулевой байт (см. комментарий к `CutSizeRow`), и в тексте теста он был бы
 * неотличим от пробела — тест «падает на невидимом символе» проверяет
 * не поведение, а внимательность читателя.
 */
const key = (size: string, color = '—') => cellKey({ color, size });

/**
 * ПРОИЗВОДСТВЕННЫЙ ПЛЮС ЗАКРОЯ (правка заказчика 21.09, п. 3).
 *
 * Пример взят из документа дословно: «если в заказе XS = 50, а по всем рулонам
 * скроено XS = 55, система должна сохранить фактический раскрой 55 шт
 * и автоматически зафиксировать плюс XS = 5 шт».
 */
const GRID = [{ color: '—', sizes: { XS: 50, S: 30 } }];

/** Строки формы: один рулон, размеры с него */
const roll = (sizes: [string, number][]) => ({
  rollId: 'r-1',
  qtyUsed: 10,
  finished: false,
  sizes: sizes.map(([size, qty]) => ({ size, color: '—', qty })),
});

describe('cutExtras', () => {
  it('скроено больше заказа — плюс по размеру и в сумме', () => {
    const res = cutExtras([roll([['XS', 55]])], GRID);
    expect(res.total).toBe(5);
    expect(res.rows).toEqual([
      { color: '—', size: 'XS', label: 'XS', planned: 50, cut: 55, extra: 5 },
    ]);
  });

  it('скроено ровно по заказу или меньше — плюса нет', () => {
    expect(cutExtras([roll([['XS', 50]])], GRID).total).toBe(0);
    expect(cutExtras([roll([['XS', 40]])], GRID).rows).toEqual([]);
  });

  /** «Один и тот же размер можно кроить из разных рулонов» (п. 2) */
  it('размер с двух рулонов складывается, а плюс считается от суммы', () => {
    const res = cutExtras([roll([['XS', 30]]), roll([['XS', 25]])], GRID);
    expect(res.total).toBe(5);
    expect(res.rows[0].cut).toBe(55);
  });

  it('плюсы считаются отдельно по каждому размеру и суммарно', () => {
    const res = cutExtras([roll([['XS', 52], ['S', 33]])], GRID);
    expect(res.total).toBe(5);
    expect(res.rows.map((r) => [r.size, r.extra])).toEqual([['XS', 2], ['S', 3]]);
  });

  /**
   * НАКОПИТЕЛЬНО: закрой сдаёт частями. Сравнивать каждую сдачу с планом
   * порознь значило бы не заметить плюс вовсе — 30 < 50 и 25 < 50, а вместе
   * это 55 при плане 50.
   */
  it('прежние сдачи учитываются: плюс появляется на второй части', () => {
    const already = { [key('XS')]: 30 };
    const res = cutExtras([roll([['XS', 25]])], GRID, already);
    expect(res.total).toBe(5);
    expect(res.rows[0].cut).toBe(55);
  });

  it('плюс ЭТОЙ сдачи — прирост превышения, а не превышение целиком', () => {
    // 60 уже сдано при плане 50 (плюс 10), сдаём ещё 5 — прирост ровно 5
    const res = cutExtras([roll([['XS', 5]])], GRID, { [key('XS')]: 60 });
    expect(res.total).toBe(5);
  });

  /**
   * FAIL-OPEN: у позиции без сетки плана нет. Объявить плюсом весь раскрой
   * значило бы записать «плюс 200 шт» там, где просто не заполнили сетку —
   * таких позиций на бою почти половина.
   */
  it('без размерной сетки плюсов не бывает', () => {
    expect(cutExtras([roll([['XS', 55]])], null)).toEqual({ rows: [], total: 0 });
    expect(cutExtras([roll([['XS', 55]])], [])).toEqual({ rows: [], total: 0 });
  });

  it('размер, которого в заказе нет вовсе, плюсом не считается', () => {
    // «M» не в сетке: это размер ВНЕ плана, про него говорит сам факт раскроя
    expect(cutExtras([roll([['M', 10]])], GRID).total).toBe(0);
  });

  it('цвет различает ячейки: XS чёрный и XS белый — разные планы', () => {
    const grid = [
      { color: 'чёрный', sizes: { XS: 10 } },
      { color: 'белый', sizes: { XS: 20 } },
    ];
    const entries = [{
      rollId: 'r-1',
      qtyUsed: 5,
      sizes: [
        { size: 'XS', color: 'чёрный', qty: 12 },
        { size: 'XS', color: 'белый', qty: 20 },
      ],
    }];
    const res = cutExtras(entries, grid);
    expect(res.total).toBe(2);
    expect(res.rows[0].label).toBe('XS · чёрный');
  });

  it('пустой ввод не падает и плюсов не даёт', () => {
    expect(cutExtras(null, GRID)).toEqual({ rows: [], total: 0 });
    expect(cutExtras([roll([])], GRID)).toEqual({ rows: [], total: 0 });
  });
});

describe('reportedSizesOf', () => {
  it('складывает сданное по ячейкам из всех отчётов', () => {
    const reports = [
      { sizes: [{ color: '—', size: 'XS', qty_good: 30 }] },
      { sizes: [{ color: '—', size: 'XS', qty_good: 10 }, { color: '—', size: 'S', qty_good: 5 }] },
    ];
    expect(reportedSizesOf(reports)).toEqual({ [key('XS')]: 40, [key('S')]: 5 });
  });

  it('отчёт без размерных строк и пустой список читаются нулём, а не падением', () => {
    expect(reportedSizesOf([{ sizes: null }])).toEqual({});
    expect(reportedSizesOf(null)).toEqual({});
  });
});

describe('cutExtrasText', () => {
  it('перечисляет плюсы по размерам', () => {
    const res = cutExtras([roll([['XS', 52], ['S', 33]])], GRID);
    expect(cutExtrasText(res)).toBe('XS — 2 шт · S — 3 шт');
  });

  it('без плюсов — пустая строка, а не «0 шт»', () => {
    expect(cutExtrasText(cutExtras([roll([['XS', 10]])], GRID))).toBe('');
  });
});
