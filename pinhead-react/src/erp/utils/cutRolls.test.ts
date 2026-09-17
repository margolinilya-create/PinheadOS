import { describe, it, expect } from 'vitest';
import type { ErpMaterial, ErpMaterialRoll, SizeGridRow } from '../types';
import {
  rollsForItem, rollLabel, cutTotals, rollTotal, cutBlock,
  cutSizesPayload, cutRollsPayload, sizeCellsOf, cellKey,
} from './cutRolls';

const roll = (n: number, extra: Partial<ErpMaterialRoll> = {}): ErpMaterialRoll => ({
  id: `r${n}`, material_id: 'm1', receipt_id: null, seq: n, label: `Рулон №${n}`,
  qty: null, unit: 'кг', status: 'in_stock', created_at: '2026-09-16', ...extra,
} as ErpMaterialRoll);

const fabric = (extra: Partial<ErpMaterial> = {}): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: 'i1', kind: 'fabric', name: 'Футер 3-нитка',
  source: 'purchase', supplier: null, role: null, color: 'чёрный', article: '1234',
  qty: null, status: 'received', eta_date: null, received_at: null, notes: null,
  qty_expected: 100, qty_received: 100, accept_status: 'accepted_full',
  accepted_at: null, accepted_by: null, accept_comment: null,
  fact_name: null, fact_color: null, fact_article: null,
  created_at: '', updated_at: '', rolls: [roll(1), roll(2)], ...extra,
} as ErpMaterial);

const GRID: SizeGridRow[] = [{ color: '—', sizes: { XS: 4, S: 8, M: 10, L: 8, XL: 6 } }];
const CELLS = sizeCellsOf(GRID);
const key = (size: string) => cellKey({ color: '—', size });

describe('rollsForItem — рулоны не вводятся вручную', () => {
  it('предлагает рулоны тканей ЭТОЙ позиции', () => {
    expect(rollsForItem([fabric()], 'i1').map((o) => o.roll.label))
      .toEqual(['Рулон №1', 'Рулон №2']);
  });

  it('материал чужой позиции не предлагается', () => {
    expect(rollsForItem([fabric({ item_id: 'i2' })], 'i1')).toEqual([]);
  });

  /**
   * Приёмка обязана вынести вердикт: рулон существует физически только после
   * того, как склад его принял. Иначе закрой отчитался бы по ткани, которой
   * на фабрике нет.
   */
  it.each([[null], ['shortage'], ['rejected'], ['mismatch']])(
    'вердикт приёмки «%s» рулоны не выдаёт', (accept) => {
      expect(rollsForItem([fabric({ accept_status: accept as never })], 'i1')).toEqual([]);
    },
  );

  it('частичная приёмка рулоны выдаёт — они уже на фабрике', () => {
    expect(rollsForItem([fabric({ accept_status: 'accepted_partial' })], 'i1')).toHaveLength(2);
  });

  it('фурнитура рулонов не даёт — кроят из ткани', () => {
    expect(rollsForItem([fabric({ kind: 'hardware' })], 'i1')).toEqual([]);
  });

  it('израсходованный рулон не предлагается заново', () => {
    const m = fabric({ rolls: [roll(1, { status: 'used' }), roll(2)] });
    expect(rollsForItem([m], 'i1').map((o) => o.roll.label)).toEqual(['Рулон №2']);
  });

  /**
   * …но уже выбранный в текущей форме остаётся видимым, иначе строка исчезла
   * бы прямо во время заполнения.
   */
  it('выбранный израсходованный рулон из списка не пропадает', () => {
    const m = fabric({ rolls: [roll(1, { status: 'used' }), roll(2)] });
    expect(rollsForItem([m], 'i1', ['r1']).map((o) => o.roll.label))
      .toEqual(['Рулон №1', 'Рулон №2']);
  });

  it('рулоны идут по номерам, а не по порядку хранения', () => {
    const m = fabric({ rolls: [roll(3), roll(1), roll(2)] });
    expect(rollsForItem([m], 'i1').map((o) => o.roll.seq)).toEqual([1, 2, 3]);
  });

  it('подпись называет рулон и по какому материалу он пришёл', () => {
    expect(rollLabel(roll(3), fabric())).toBe('Рулон №3 · Футер 3-нитка · чёрный · арт. 1234');
  });

  it('подпись берёт ФАКТИЧЕСКИЕ атрибуты, когда склад отметил пересорт', () => {
    const m = fabric({ fact_name: 'Футер 2-нитка', fact_color: 'синий', fact_article: '9' });
    expect(rollLabel(roll(1), m)).toBe('Рулон №1 · Футер 2-нитка · синий · арт. 9');
  });
});

describe('автоматические итоги', () => {
  const entries = [
    { rollId: 'r1', qtyUsed: 19.4, sizes: { [key('XS')]: 4, [key('S')]: 8, [key('M')]: 10 } },
    { rollId: 'r2', qtyUsed: 19.4, sizes: { [key('L')]: 8, [key('XL')]: 6, [key('M')]: 2 } },
  ];

  it('итог с одного рулона — сумма его размеров', () => {
    expect(rollTotal(entries[0])).toBe(22);
  });

  it('общий итог складывает рулоны и размеры', () => {
    const totals = cutTotals(entries);
    expect(totals.qty).toBe(38);
    expect(totals.rolls).toBe(2);
    expect(totals.bySize[key('M')]).toBe(12);
  });

  /**
   * Расход — дробное число (метры, килограммы). Без округления 19.4 + 19.4
   * даёт 38.800000000000004 прямо в подписи цеху.
   */
  it('расход ткани складывается без хвоста двоичной дроби', () => {
    expect(cutTotals(entries).used).toBe(38.8);
  });

  it('пустые строки в итог не попадают', () => {
    expect(cutTotals([{ rollId: 'r1', qtyUsed: 0, sizes: {} }]).rolls).toBe(0);
    expect(cutTotals(null).qty).toBe(0);
  });
});

describe('cutBlock — почему нельзя сдать', () => {
  it('без рулонов сдавать нечего', () => {
    expect(cutBlock([])).toContain('Добавьте рулон');
  });

  it('рулон без расхода назван по имени', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock([{ rollId: 'r1', qtyUsed: 0, sizes: { [key('XS')]: 4 } }], options);
    expect(block).toContain('Рулон №1');
    expect(block).toContain('расход');
  });

  it('рулон без изделий назван по имени', () => {
    const options = rollsForItem([fabric()], 'i1');
    const block = cutBlock([{ rollId: 'r2', qtyUsed: 19, sizes: {} }], options);
    expect(block).toContain('Рулон №2');
    expect(block).toContain('скроено');
  });

  it('один рулон дважды — это ошибка ввода, а не два рулона', () => {
    const options = rollsForItem([fabric()], 'i1');
    const twice = [
      { rollId: 'r1', qtyUsed: 10, sizes: { [key('XS')]: 2 } },
      { rollId: 'r1', qtyUsed: 10, sizes: { [key('S')]: 2 } },
    ];
    expect(cutBlock(twice, options)).toContain('дважды');
  });

  it('заполненная форма не блокируется', () => {
    const options = rollsForItem([fabric()], 'i1');
    expect(cutBlock([{ rollId: 'r1', qtyUsed: 19, sizes: { [key('XS')]: 4 } }], options)).toBeNull();
  });
});

describe('что уезжает в отчёт этапа', () => {
  const entries = [
    { rollId: 'r1', qtyUsed: 19.4, sizes: { [key('XS')]: 4, [key('S')]: 8 } },
    { rollId: 'r2', qtyUsed: 12, sizes: { [key('S')]: 2 }, finished: true },
  ];

  it('размеры — суммой по всем рулонам, в порядке сетки позиции', () => {
    expect(cutSizesPayload(entries, CELLS)).toEqual([
      { color: '—', size: 'XS', qty_good: 4 },
      { color: '—', size: 'S', qty_good: 10 },
    ]);
  });

  it('строки рулонов несут расход, материал и признак «израсходован»', () => {
    const options = rollsForItem([fabric()], 'i1');
    const payload = cutRollsPayload(entries, options);
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ roll_id: 'r1', material_id: 'm1', qty_used: 19.4, finished: false });
    expect(payload[1]).toMatchObject({ roll_id: 'r2', finished: true });
    expect(payload[1].sizes).toEqual([{ color: '—', size: 'S', qty_good: 2 }]);
  });

  it('пустая строка рулона в отчёт не уезжает', () => {
    expect(cutRollsPayload([{ rollId: 'r1', qtyUsed: 5, sizes: {} }])).toEqual([]);
  });
});
