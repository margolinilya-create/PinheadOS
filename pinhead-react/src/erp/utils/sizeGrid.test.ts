import { describe, it, expect } from 'vitest';
import type { SizeGridRow } from '../types';
import {
  gridCells, gridRowsTotal, mergeGrids, cellsToGrid, gridSizes, sizeOrderIndex,
} from './sizeGrid';

// Аннотация обязательна: без неё вывод типов делает из двух строк с разным
// набором размеров union, где у каждого ключа появляется `undefined`
const GRID: SizeGridRow[] = [
  { color: 'чёрный', sizes: { M: 30, XS: 10, S: 20 } },
  { color: 'белый', sizes: { XL: 15, L: 25 } },
];

describe('gridRowsTotal', () => {
  it('складывает все размеры всех цветов', () => {
    expect(gridRowsTotal(GRID)).toBe(100);
  });

  /**
   * Сетка приезжает из базы (`erp_order_items.size_grid`), из урезанной
   * выборки и из старых заказов — то есть чем угодно. Ноль честнее падения:
   * на этом числе стоит тираж закупки и потолок приёмки.
   */
  it.each([
    ['пусто', null],
    ['не массив', { XS: 5 } as unknown],
    ['строка вместо количества', [{ color: 'ч', sizes: { M: 'десять' } }] as unknown],
    ['строка без sizes', [{ color: 'ч' }] as unknown],
  ])('%s читается нулём, а не падением', (_name, value) => {
    expect(gridRowsTotal(value as never)).toBe(0);
  });

  it('отрицательные количества не уменьшают тираж', () => {
    expect(gridRowsTotal([{ color: 'ч', sizes: { XS: 10, S: -4 } }])).toBe(10);
  });
});

describe('sizeOrderIndex / gridSizes', () => {
  it('размеры идут по шкале, а не по алфавиту и не по порядку ключей', () => {
    expect(gridSizes(GRID)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  /**
   * Размеры — КЛЮЧИ ОБЪЕКТА, и пресет можно менять без миграции: у старых
   * заказов встречаются свои. Незнакомый размер обязан остаться видимым,
   * иначе его количество исчезнет с экрана, оставшись в данных.
   */
  it('незнакомый размер не теряется, а встаёт после известных', () => {
    const grid = [{ color: 'ч', sizes: { M: 1, 'ЖЕН-46': 2, XS: 3 } }];
    expect(gridSizes(grid)).toEqual(['XS', 'M', 'ЖЕН-46']);
  });

  it('детская шкала упорядочивается числами, а не строками', () => {
    const grid = [{ color: 'ч', sizes: { 116: 1, 98: 2, 104: 3 } }];
    expect(gridSizes(grid)).toEqual(['98', '104', '116']);
  });

  it('неизвестные размеры между собой идут по алфавиту — порядок обязан быть устойчивым', () => {
    expect(sizeOrderIndex('XS')).toBeLessThan(sizeOrderIndex('XL'));
    expect(sizeOrderIndex('ААА')).toBeGreaterThan(sizeOrderIndex('5XL'));
  });
});

describe('gridCells', () => {
  it('разворачивает сетку в строки «цвет × размер» в порядке шкалы', () => {
    expect(gridCells(GRID)).toEqual([
      { color: 'чёрный', size: 'XS', qty: 10 },
      { color: 'чёрный', size: 'S', qty: 20 },
      { color: 'чёрный', size: 'M', qty: 30 },
      { color: 'белый', size: 'L', qty: 25 },
      { color: 'белый', size: 'XL', qty: 15 },
    ]);
  });

  it('нулевые размеры не разворачиваются в строки', () => {
    expect(gridCells([{ color: 'ч', sizes: { XS: 0, S: 5 } }]))
      .toEqual([{ color: 'ч', size: 'S', qty: 5 }]);
  });

  it('позиция без цветового деления получает прочерк — то же значение, что пишет форма заказа', () => {
    expect(gridCells([{ color: '', sizes: { S: 5 } }]))
      .toEqual([{ color: '—', size: 'S', qty: 5 }]);
  });
});

describe('mergeGrids', () => {
  /**
   * Приёмка бывает частичной, и вторая поставка ДОБАВЛЯЕТ: 40 + 60 = 100.
   * Перезапись показала бы «принято 60» там, где принято сто.
   */
  it('складывает одинаковые цвет+размер', () => {
    const a = [{ color: 'ч', sizes: { XS: 10, S: 20 } }];
    const b = [{ color: 'ч', sizes: { S: 5, M: 30 } }];
    expect(mergeGrids(a, b)).toEqual([{ color: 'ч', sizes: { XS: 10, S: 25, M: 30 } }]);
  });

  it('разные цвета остаются разными строками', () => {
    const merged = mergeGrids([{ color: 'ч', sizes: { S: 1 } }], [{ color: 'б', sizes: { S: 2 } }]);
    expect(merged).toHaveLength(2);
    expect(gridRowsTotal(merged)).toBe(3);
  });

  it('пустые слагаемые не ломают сумму', () => {
    expect(mergeGrids(null, [{ color: 'ч', sizes: { S: 2 } }])).toEqual([{ color: 'ч', sizes: { S: 2 } }]);
    expect(mergeGrids(null, null)).toEqual([]);
  });
});

describe('cellsToGrid', () => {
  it('собирает сетку обратно из строк формы', () => {
    const cells = [
      { color: 'ч', size: 'XS', qty: 4 },
      { color: 'ч', size: 'S', qty: 0 },
      { color: 'б', size: 'M', qty: 2 },
    ];
    expect(cellsToGrid(cells)).toEqual([
      { color: 'ч', sizes: { XS: 4 } },
      { color: 'б', sizes: { M: 2 } },
    ]);
  });

  it('пустой результат — пустой массив, а не строка с нулями', () => {
    expect(cellsToGrid([{ color: 'ч', size: 'XS', qty: 0 }])).toEqual([]);
  });
});
