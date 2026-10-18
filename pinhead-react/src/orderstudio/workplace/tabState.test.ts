import { describe, it, expect } from 'vitest';
import { revealTab, tabState } from './tabState';
import type { SalesOrder } from '../model/types';

const rect = (left: number, right: number) => ({ left, right, top: 0, bottom: 0, width: right - left, height: 0 });

/** Ряд вкладок шириной 300, прокручивается; вкладка — в заданных координатах */
function setup(tabLeft: number, tabRight: number, { scrollable = true } = {}) {
  const row = document.createElement('div');
  const tab = document.createElement('button');
  row.appendChild(tab);
  Object.defineProperty(row, 'scrollWidth', { value: scrollable ? 600 : 300 });
  Object.defineProperty(row, 'clientWidth', { value: 300 });
  row.getBoundingClientRect = () => rect(0, 300) as DOMRect;
  tab.getBoundingClientRect = () => rect(tabLeft, tabRight) as DOMRect;
  row.scrollLeft = 100;
  return { row, tab };
}

describe('revealTab — активная вкладка в видимой части ряда (≤ 480 px)', () => {
  it('вкладка правее края — ряд сдвигается вправо ровно на выступ', () => {
    const { row, tab } = setup(280, 360);
    revealTab(tab);
    expect(row.scrollLeft).toBe(160);
  });

  it('вкладка левее края — ряд сдвигается влево', () => {
    const { row, tab } = setup(-40, 40);
    revealTab(tab);
    expect(row.scrollLeft).toBe(60);
  });

  it('вкладка видна или ряд не прокручивается — ничего не двигается', () => {
    const a = setup(20, 120);
    revealTab(a.tab);
    expect(a.row.scrollLeft).toBe(100);
    const b = setup(280, 360, { scrollable: false });
    revealTab(b.tab);
    expect(b.row.scrollLeft).toBe(100);
    expect(() => revealTab(undefined)).not.toThrow();
  });
});

describe('tabState', () => {
  const order = (over: Partial<SalesOrder> = {}) => ({ items: [], customer: '', ...over }) as SalesOrder;
  it('пустой заказ: изделие и клиент «не заполнено», дизайн и ТЗ без маркера', () => {
    expect(tabState('item', order())).toEqual({ text: 'не заполнено' });
    expect(tabState('client', order())).toEqual({ text: 'не заполнено' });
    expect(tabState('design', order())).toBeNull();
    expect(tabState('summary', order())).toBeNull();
  });
  it('клиент заполнен — готово', () => {
    expect(tabState('client', order({ customer: 'ООО Тест' }))).toEqual({ ready: true });
  });
});
