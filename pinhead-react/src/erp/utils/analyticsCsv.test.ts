import { describe, it, expect } from 'vitest';
import {
  analyticsCsv, analyticsCsvFileName, csvNumber, csvFlag, csvText, CSV_BOM,
} from './analyticsCsv';
import type { AnalyticsSnapshot } from '../store/types';

/**
 * ВЫГРУЗКА АНАЛИТИКИ В CSV (правка 27.09, п. 5).
 *
 * Сторож держит то, на чём Excel ломается молча: BOM, разделитель `;`,
 * десятичную запятую, пустую ячейку вместо null, единицы в заголовках
 * в метрах и отметки «расчёт»/«неполные данные».
 */

const SNAP: AnalyticsSnapshot = {
  overview: {
    from: '2026-08-18', to: '2026-09-16', prev_from: '2026-07-19', prev_to: '2026-08-17',
    released: 120, released_prev: 100, defect: 4, rework: 2, extra: 5,
    assembly_avg: null, assembly_covered_qty: 0,
    fabric_kg: 48.6, fabric_rolls: 3,
    fabric_m: 112.5, fabric_cut_good: 120, fabric_per_item: 0.9375,
    fabric_calc: true, fabric_incomplete: false,
  },
  series: [
    { bucket: '2026-09-15', released: 120, defect: 4, rework: 2, extra: 5, fabric: 112.5,
      fabric_calc: true, fabric_incomplete: false },
    { bucket: '2026-09-16', released: 10, defect: 0, rework: 0, extra: 0, fabric: 9,
      fabric_calc: false, fabric_incomplete: true },
    // Сервер без флагов (до правки 28.09) — пустые ячейки, а не «нет»
    { bucket: '2026-09-17', released: 1, defect: 0, rework: 0, extra: 0, fabric: 1 },
  ],
  bySku: [],
  byDept: [{ department_id: 'd-sew', done_qty: 120, defect: 4, rework: 2, defect_pct: 3.2 }],
  fabricBySku: [{
    product_type: 'Футболка', material: 'Кулирка; пенье', width_cm: 180, fabric_m: 112.5,
    cut_good: 120, per_item: null, calc: true, incomplete: true, orders: 2,
  }],
};

describe('csvNumber / csvFlag / csvText', () => {
  it('десятичная запятая, без разделителя разрядов', () => {
    expect(csvNumber(1234.5)).toBe('1234,5');
    expect(csvNumber(0.93751234)).toBe('0,9375');
    expect(csvNumber(0)).toBe('0');
  });

  it('null, undefined и нечисло — пустая ячейка, а не 0 и не «—»', () => {
    expect(csvNumber(null)).toBe('');
    expect(csvNumber(undefined)).toBe('');
    expect(csvNumber('abc')).toBe('');
  });

  it('флаг — да/нет, отсутствующий — пусто', () => {
    expect(csvFlag(true)).toBe('да');
    expect(csvFlag(false)).toBe('нет');
    expect(csvFlag(null)).toBe('');
  });

  it('текст с разделителем или кавычкой берётся в кавычки', () => {
    expect(csvText('a;b')).toBe('"a;b"');
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText('Футболка')).toBe('Футболка');
  });
});

describe('analyticsCsv', () => {
  const csv = analyticsCsv(SNAP, { deptNames: new Map([['d-sew', 'Швейный цех']]) });
  const lines = csv.split('\r\n');

  it('начинается с BOM и разделён `;`', () => {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain('Показатель;Значение');
  });

  it('сводка — в метрах, с отметками расчёта и неполноты', () => {
    expect(lines).toContain('Использовано ткани, м;112,5');
    expect(lines).toContain('Средний расход ткани, м/изделие;0,9375');
    expect(lines).toContain('Средняя себестоимость сборки, ₽/шт;');
    expect(lines).toContain('Расчёт (часть строк пересчитана из кг);да');
    expect(lines).toContain('Неполные данные (часть строк не пересчитана);нет');
    expect(csv).not.toMatch(/кг\/изделие|Ткань, кг/);
  });

  it('ноль метров — пустая ячейка («нет данных»), а не 0', () => {
    const empty = analyticsCsv({
      ...SNAP, overview: { ...SNAP.overview!, fabric_m: 0 },
    });
    expect(empty.split('\r\n')).toContain('Использовано ткани, м;');
  });

  it('динамика с колонкой «Ткань, м» и отметками расчёта и неполноты', () => {
    expect(lines).toContain(
      'День;Выпущено, шт;Брак, шт;Переделка, шт;Плюсы, шт;Ткань, м;Расчёт;Неполные данные',
    );
    expect(lines).toContain('2026-09-15;120;4;2;5;112,5;да;нет');
    expect(lines).toContain('2026-09-16;10;0;0;0;9;нет;да');
    expect(lines).toContain('2026-09-17;1;0;0;0;1;;');
    const week = analyticsCsv(SNAP, { bucket: 'week' });
    expect(week).toContain('Неделя;Выпущено, шт');
  });

  it('«Расход полотна по моделям» — метры, флаги и пустая ячейка для null', () => {
    expect(lines).toContain('Расход полотна по моделям');
    expect(lines).toContain(
      'Изделие;Материал;Ширина, см;Ткань, м;Годных скроено, шт;Расход, м/изделие;Расчёт;Неполные данные;Заказов',
    );
    expect(lines).toContain('Футболка;"Кулирка; пенье";180;112,5;120;;да;да;2');
  });

  it('цеха подписаны именем', () => {
    expect(lines).toContain('Швейный цех;120;4;2;3,2');
  });

  it('без сводки выгрузка не падает', () => {
    expect(() => analyticsCsv({ ...SNAP, overview: null })).not.toThrow();
  });
});

describe('analyticsCsvFileName', () => {
  it('ASCII-имя с периодом', () => {
    expect(analyticsCsvFileName(SNAP.overview)).toBe('analytics-2026-08-18_2026-09-16.csv');
    expect(analyticsCsvFileName(null)).toBe('analytics.csv');
  });
});
