import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { addDays, isoDate, localToday, mondayOfWeek, parseIsoDate, weekdayIndex } from './date';

/**
 * Тесты идут В МОСКОВСКОМ ПОЯСЕ, а не в поясе машины.
 *
 * Контейнер CI живёт в UTC, и там ошибка «дата из UTC» НЕ ВОСПРОИЗВОДИТСЯ вовсе:
 * сдвиг равен нулю, любая реализация проходит. Именно поэтому доска плана
 * приехала на прод со сдвигом в двое суток при зелёных тестах. Пояс заказчика —
 * UTC+3, его и берём: `process.env.TZ` в Node ≥ 16 действует на новые `Date`.
 */
const REAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Moscow'; });
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

describe('isoDate — календарная дата в поясе человека', () => {
  it('локальная полночь остаётся своим днём', () => {
    // Именно здесь ломался `toISOString().slice(0, 10)`: 10.08 00:00 MSK — это
    // 09.08 21:00 UTC, и «слайс от ISO» отдавал девятое
    expect(isoDate(new Date('2026-08-10T00:00:00'))).toBe('2026-08-10');
  });

  it('последняя минута суток тоже своя', () => {
    expect(isoDate(new Date('2026-08-10T23:59:59'))).toBe('2026-08-10');
  });

  it('однозначные месяц и день дополняются нулём', () => {
    expect(isoDate(new Date('2026-01-05T12:00:00'))).toBe('2026-01-05');
  });

  it('момент UTC переводится в местную дату, а не остаётся в UTC', () => {
    // 31.08 22:00 UTC в Москве — уже первое сентября
    expect(isoDate(new Date('2026-08-31T22:00:00Z'))).toBe('2026-09-01');
  });
});

describe('localToday', () => {
  it('формат YYYY-MM-DD', () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('совпадает с локальными полями Date', () => {
    const n = new Date();
    expect(localToday()).toBe(isoDate(n));
  });
});

describe('addDays', () => {
  it.each([
    ['2026-08-10', 0, '2026-08-10'],
    ['2026-08-10', 1, '2026-08-11'],
    ['2026-08-10', -1, '2026-08-09'],
    ['2026-08-10', 7, '2026-08-17'],
    ['2026-08-31', 1, '2026-09-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2028-02-28', 1, '2028-02-29'],
  ])('%s %+d → %s', (base, days, want) => {
    expect(addDays(base, days)).toBe(want);
  });
});

describe('weekdayIndex — понедельник это ноль', () => {
  it.each([
    ['2026-08-10', 0, 'понедельник'],
    ['2026-08-11', 1, 'вторник'],
    ['2026-08-14', 4, 'пятница'],
    ['2026-08-15', 5, 'суббота'],
    ['2026-08-16', 6, 'воскресенье'],
  ])('%s → %i (%s)', (iso, want) => {
    expect(weekdayIndex(iso)).toBe(want);
  });
});

describe('mondayOfWeek', () => {
  it('понедельник — сам себе понедельник', () => {
    // Ровно тот случай со скриншота заказчика: 10.08.2026 — понедельник,
    // а экран показывал неделю с субботы 08.08
    expect(mondayOfWeek('2026-08-10')).toBe('2026-08-10');
  });

  it.each([
    ['2026-08-11', '2026-08-10'],
    ['2026-08-14', '2026-08-10'],
    ['2026-08-16', '2026-08-10'], // воскресенье принадлежит УХОДЯЩЕЙ неделе
    ['2026-08-17', '2026-08-17'],
  ])('%s → %s', (iso, want) => {
    expect(mondayOfWeek(iso)).toBe(want);
  });

  it('через границу месяца', () => {
    expect(mondayOfWeek('2026-09-02')).toBe('2026-08-31');
  });
});

describe('parseIsoDate', () => {
  it('даёт локальную полночь, а не UTC-полночь', () => {
    const d = parseIsoDate('2026-08-10');
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(10);
  });
});

/**
 * Сторож: календарная дата не берётся из `toISOString()` НИГДЕ.
 *
 * Обычный тест этого не поймает — в UTC обе реализации совпадают, а пояс тестов
 * задаёт машина. Поэтому сторожим сам оборот в исходниках: он и есть ошибка,
 * независимо от того, где её запускают.
 */
describe('в исходниках нет календарных дат из UTC', () => {
  const SRC = join(process.cwd(), 'src');
  const BAD = /toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/;

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) { sources(abs, out); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
      // Тесты вправе строить даты как угодно — они фиксируют ожидание, а не поведение
      if (/\.test\.(ts|tsx|js|jsx)$/.test(name)) continue;
      out.push(abs);
    }
    return out;
  }

  /**
   * Комментарии снимаются перед проверкой ОТСУТСТВИЯ — правило проекта.
   * Объяснение «почему так больше не пишем» содержит ровно тот же оборот,
   * и без этого тест ловил бы объяснения вместо кода.
   */
  const stripComments = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  it('ни один рабочий файл не режет дату из ISO-строки', () => {
    const hits = sources(SRC)
      .filter((f) => BAD.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f));
    expect(hits, `дата из UTC вместо localToday()/isoDate(): ${hits.join(', ')}`).toEqual([]);
  });
});
