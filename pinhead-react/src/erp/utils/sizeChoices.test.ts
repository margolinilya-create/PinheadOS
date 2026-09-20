import { describe, it, expect } from 'vitest';
import {
  sizeChoicesFor, hasPlannedSizes, normalizeSize, isSizeTaken, freeChoices, choiceKey,
} from './sizeChoices';
import { NO_COLOR } from './sizeGrid';

describe('sizeChoicesFor — сетка позиции это предпочтение, а не условие', () => {
  it('есть сетка: варианты из неё, с планом по каждому размеру', () => {
    const choices = sizeChoicesFor([{ color: 'чёрный', sizes: { M: 20, S: 10 } }]);
    expect(choices.map((c) => c.size)).toEqual(['S', 'M']); // порядок шкалы
    expect(choices.map((c) => c.planned)).toEqual([10, 20]);
    expect(choices.every((c) => c.color === 'чёрный')).toBe(true);
  });

  it('несколько цветов: размер и цвет вместе — это разные строки', () => {
    const choices = sizeChoicesFor([
      { color: 'чёрный', sizes: { M: 5 } },
      { color: 'белый', sizes: { M: 7 } },
    ]);
    expect(choices).toHaveLength(2);
    expect(choices.map((c) => c.label)).toEqual(['M · чёрный', 'M · белый']);
    // Ключи разные — иначе вторая строка затёрла бы первую
    expect(choiceKey(choices[0])).not.toBe(choiceKey(choices[1]));
  });

  it('один цвет без деления: подпись без цвета — он ничего не различает', () => {
    const choices = sizeChoicesFor([{ color: NO_COLOR, sizes: { L: 3 } }]);
    expect(choices[0].label).toBe('L');
  });

  /**
   * ГЛАВНОЕ СВОЙСТВО (правка 20.09, пп. 7-8). До неё пустая сетка означала
   * «размеров нет вовсе», и цех получал одно поле на весь рулон. На бою так
   * заведена 21 позиция из 49 — именно на такой заказчик и проверял.
   */
  it('сетки нет: цех всё равно получает шкалу, а не пустоту', () => {
    const choices = sizeChoicesFor(null);
    expect(choices.length).toBeGreaterThan(10);
    expect(choices.map((c) => c.size)).toContain('M');
    expect(choices.map((c) => c.size)).toContain('104'); // детская тоже
    // Сравнивать не с чем — план не выдумывается
    expect(choices.every((c) => c.planned === null)).toBe(true);
    expect(hasPlannedSizes(null)).toBe(false);
  });

  it('пустой массив сетки читается как её отсутствие, а не как «ноль размеров»', () => {
    expect(sizeChoicesFor([]).length).toBeGreaterThan(10);
    expect(hasPlannedSizes([])).toBe(false);
  });
});

describe('normalizeSize — «m» и «M» это один размер', () => {
  it('буквенные приводятся к верхнему регистру', () => {
    expect(normalizeSize(' m ')).toBe('M');
    expect(normalizeSize('xxl')).toBe('XXL');
  });

  it('числовые детские не трогаются', () => {
    expect(normalizeSize('104')).toBe('104');
  });

  it('пустая строка остаётся пустой — строка без размера не сохраняется', () => {
    expect(normalizeSize('   ')).toBe('');
  });
});

describe('isSizeTaken / freeChoices — один размер в рулоне один раз', () => {
  const rows = [{ size: 'M', color: NO_COLOR }, { size: 'L', color: NO_COLOR }];

  it('занятый размер виден', () => {
    expect(isSizeTaken(rows, { size: 'M', color: NO_COLOR })).toBe(true);
    expect(isSizeTaken(rows, { size: 'S', color: NO_COLOR })).toBe(false);
  });

  it('свою же строку занятой не считает — иначе её нельзя было бы править', () => {
    expect(isSizeTaken(rows, { size: 'M', color: NO_COLOR }, 0)).toBe(false);
  });

  it('тот же размер другого цвета — не дубль', () => {
    expect(isSizeTaken(
      [{ size: 'M', color: 'чёрный' }],
      { size: 'M', color: 'белый' },
    )).toBe(false);
  });

  it('при добавлении рулона даёт две РАЗНЫЕ свободные строки', () => {
    const choices = sizeChoicesFor([{ color: NO_COLOR, sizes: { S: 5, M: 5, L: 5 } }]);
    const two = freeChoices(choices, [], 2);
    expect(two).toHaveLength(2);
    expect(two[0].size).not.toBe(two[1].size);
  });

  it('свободных меньше двух — отдаёт сколько есть, а не занятые повторно', () => {
    const choices = sizeChoicesFor([{ color: NO_COLOR, sizes: { S: 5 } }]);
    expect(freeChoices(choices, [{ size: 'S', color: NO_COLOR }], 2)).toEqual([]);
  });
});
