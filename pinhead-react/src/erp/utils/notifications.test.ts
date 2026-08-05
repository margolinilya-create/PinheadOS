import { describe, it, expect } from 'vitest';
import { groupNotices, noticeCount, urgentCount } from './notifications';
import type { Notice } from './notifications';

const overdue = (id: string, days: number): Notice => ({
  id, orderId: id, kind: 'overdue', text: `Просрочен заказ №${id}`, sub: 'Заказ', overdueDays: days,
});
const proc = (id: string): Notice => ({
  id, orderId: id, kind: 'procurement', text: 'Дозакупка', sub: 'Заказ',
});
const blocked = (id: string): Notice => ({
  id, orderId: id, kind: 'blocked', text: 'Остановлен этап', sub: 'Заказ',
});

describe('groupNotices — уведомления по критичности', () => {
  it('пустой вход — пустой выход, а не группы-пустышки', () => {
    expect(groupNotices([])).toEqual([]);
  });

  it('пустые группы не показываются', () => {
    const groups = groupNotices([proc('a')]);
    expect(groups.map((g) => g.key)).toEqual(['procurement']);
  });

  it('порядок групп — по срочности, а не по данным', () => {
    // Специально в обратном порядке: результат не должен от него зависеть
    const groups = groupNotices([
      overdue('stale', 60), overdue('month', 20), proc('p'), overdue('week', 3), blocked('b'),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      'blocked', 'overdue-week', 'procurement', 'overdue-month', 'overdue-stale',
    ]);
  });

  it('срочное развёрнуто, давнее свёрнуто', () => {
    const groups = groupNotices([overdue('w', 2), overdue('m', 20), overdue('s', 90)]);
    const open = Object.fromEntries(groups.map((g) => [g.key, g.open]));
    expect(open).toEqual({
      'overdue-week': true, 'overdue-month': false, 'overdue-stale': false,
    });
  });

  it('внутри группы просрочки — самый давний сверху', () => {
    const groups = groupNotices([overdue('a', 2), overdue('b', 7), overdue('c', 5)]);
    expect(groups[0].items.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('у каждой группы есть текстовая подсказка, что делать', () => {
    const groups = groupNotices([overdue('w', 2), overdue('m', 20), proc('p'), blocked('b')]);
    for (const g of groups) {
      expect(g.hint.length).toBeGreaterThan(10);
      expect(g.title).toBeTruthy();
    }
  });

  it('боевая раскладка 03.08.2026: 47 просрочек разносятся, срочных — шесть', () => {
    const notices = [
      ...Array.from({ length: 6 }, (_, i) => overdue(`w${i}`, 3)),
      ...Array.from({ length: 39 }, (_, i) => overdue(`m${i}`, 15)),
      ...Array.from({ length: 2 }, (_, i) => overdue(`s${i}`, 40)),
    ];
    const groups = groupNotices(notices);
    expect(noticeCount(groups)).toBe(47);
    // Вот ради чего всё: «47» не отвечало ни на один вопрос, «6» отвечает
    expect(urgentCount(groups)).toBe(6);
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ['overdue-week', 6], ['overdue-month', 39], ['overdue-stale', 2],
    ]);
  });

  it('просрочка на границе ступени попадает в свою группу', () => {
    const groups = groupNotices([overdue('a', 7), overdue('b', 8), overdue('c', 30), overdue('d', 31)]);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((n) => n.id)]));
    expect(byKey['overdue-week']).toEqual(['a']);
    expect(byKey['overdue-month']).toEqual(['c', 'b']);
    expect(byKey['overdue-stale']).toEqual(['d']);
  });
});
