import { describe, it, expect } from 'vitest';
import {
  NO_SORT,
  ariaSortFor,
  compareValues,
  nextSortState,
  sortRows,
} from './tableSort';

interface Row { name: string; qty: number | null; supplier: string | null }

const rows: Row[] = [
  { name: 'Футер', qty: 30, supplier: 'Тексим' },
  { name: 'Кулирка', qty: null, supplier: null },
  { name: 'Рибана', qty: 5, supplier: 'Альфа' },
  { name: 'Флис', qty: 30, supplier: '' },
];

const valueOf = (r: Row, key: string) => r[key as keyof Row];

describe('nextSortState — цикл клика по заголовку', () => {
  it('первый клик по новой колонке — по возрастанию', () => {
    expect(nextSortState(NO_SORT, 'qty')).toEqual({ key: 'qty', dir: 'asc' });
  });

  it('второй клик по той же колонке — по убыванию', () => {
    expect(nextSortState({ key: 'qty', dir: 'asc' }, 'qty')).toEqual({ key: 'qty', dir: 'desc' });
  });

  it('третий клик снимает сортировку — исходный порядок бывает осмысленным', () => {
    expect(nextSortState({ key: 'qty', dir: 'desc' }, 'qty')).toEqual(NO_SORT);
  });

  it('переход на другую колонку начинает с возрастания', () => {
    expect(nextSortState({ key: 'qty', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('sortRows', () => {
  it('без ключа возвращает исходный массив как есть', () => {
    expect(sortRows(rows, NO_SORT, valueOf)).toBe(rows);
  });

  it('числа сравниваются числами, а не строками', () => {
    const sorted = sortRows(rows, { key: 'qty', dir: 'asc' }, valueOf);
    expect(sorted.map((r) => r.qty)).toEqual([5, 30, 30, null]);
  });

  it('пустые значения внизу и при сортировке по убыванию', () => {
    const asc = sortRows(rows, { key: 'supplier', dir: 'asc' }, valueOf);
    const desc = sortRows(rows, { key: 'supplier', dir: 'desc' }, valueOf);
    expect(asc[asc.length - 1].supplier ?? '').toBe('');
    expect(desc[desc.length - 1].supplier ?? '').toBe('');
    // и null, и пустая строка считаются пустыми
    expect(desc.slice(-2).map((r) => r.name).sort()).toEqual(['Кулирка', 'Флис']);
  });

  it('сортировка стабильна: равные значения держат исходный порядок', () => {
    // Футер и Флис оба по 30 кг — Футер шёл раньше и должен остаться раньше
    const sorted = sortRows(rows, { key: 'qty', dir: 'asc' }, valueOf);
    const names = sorted.filter((r) => r.qty === 30).map((r) => r.name);
    expect(names).toEqual(['Футер', 'Флис']);
  });

  it('пустые между собой тоже сохраняют исходный порядок', () => {
    const many: Row[] = [
      { name: 'б', qty: null, supplier: null },
      { name: 'а', qty: null, supplier: null },
    ];
    expect(sortRows(many, { key: 'qty', dir: 'asc' }, valueOf).map((r) => r.name))
      .toEqual(['б', 'а']);
  });

  it('не мутирует исходный массив', () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, { key: 'name', dir: 'desc' }, valueOf);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe('compareValues', () => {
  it('номера заказов сортируются по-человечески: №9 перед №10', () => {
    expect(compareValues('9', '10')).toBeLessThan(0);
  });

  it('регистр и раскладка не мешают', () => {
    expect(compareValues('кулирка', 'Кулирка')).toBe(0);
  });

  it('булево: false перед true', () => {
    expect(compareValues(false, true)).toBeLessThan(0);
  });
});

describe('ariaSortFor', () => {
  it('none для неактивной колонки, направление — для активной', () => {
    expect(ariaSortFor({ key: 'qty', dir: 'asc' }, 'name')).toBe('none');
    expect(ariaSortFor({ key: 'qty', dir: 'asc' }, 'qty')).toBe('ascending');
    expect(ariaSortFor({ key: 'qty', dir: 'desc' }, 'qty')).toBe('descending');
  });
});
