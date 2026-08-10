import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FACTORY_TIMEZONE, addDays, diffDays, factoryDate, factoryToday,
  monthBounds, monthDates, mondayOfWeek, parseIsoDate, weekdayIndex,
} from './date';

/**
 * ПОЯС ПРОИЗВОДСТВА — московское время (решение заказчика). «Сегодня» на
 * фабрике одно для всех: менеджер, открывший ERP из другого пояса, обязан
 * видеть день ЦЕХА, а не свой.
 *
 * Отсюда главная проверка этого файла — НЕЗАВИСИМОСТЬ ОТ ПОЯСА МАШИНЫ.
 * Прежняя реализация читала местные поля браузера, и контейнер CI в UTC
 * не воспроизводил ошибку вовсе: сдвиг равен нулю, проходила любая
 * реализация. Поэтому каждый расчёт прогоняется в нескольких поясах —
 * западном, восточном и самой Москве.
 */
const ZONES = ['UTC', 'Europe/Moscow', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata'];

const REAL_TZ = process.env.TZ;
afterEach(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

/** Выполнить проверку в каждом поясе: результат обязан совпасть везде */
function inEveryZone(check: () => void): void {
  for (const zone of ZONES) {
    process.env.TZ = zone;
    try {
      check();
    } catch (e) {
      throw new Error(`пояс машины ${zone}: ${(e as Error).message}`);
    }
  }
}

/** Все рабочие файлы проекта: тесты вправе строить даты как угодно — они фиксируют ожидание */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) { sources(abs, out); continue; }
    if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx|js|jsx)$/.test(name)) continue;
    out.push(abs);
  }
  return out;
}

const SRC = join(process.cwd(), 'src');

describe('пояс производства назван один раз', () => {
  it('это московское время', () => {
    expect(FACTORY_TIMEZONE).toBe('Europe/Moscow');
  });

  it('тот же пояс стоит на сервере', () => {
    // Две стороны одной системы не могут расходиться в том, какое сегодня число
    const sql = readFileSync(
      join(process.cwd(), '../supabase/migrations/20260810360000_erp_local_calendar_date.sql'),
      'utf8',
    );
    expect(sql).toContain(`at time zone '${FACTORY_TIMEZONE}'`);
  });
});

describe('factoryDate — момент → календарный день фабрики', () => {
  it('день фабрики не зависит от пояса машины', () => {
    const moment = new Date('2026-08-10T12:00:00Z');
    inEveryZone(() => {
      expect(factoryDate(moment)).toBe('2026-08-10');
    });
  });

  it('вечер по Гринвичу — это уже следующий день на фабрике', () => {
    // 10.08 21:30 UTC = 11.08 00:30 МСК. Ровно этот случай ловил упавший
    // тест `shiftIsoDate` — он считал «сегодня» по Гринвичу
    const moment = new Date('2026-08-10T21:30:00Z');
    inEveryZone(() => {
      expect(factoryDate(moment)).toBe('2026-08-11');
    });
  });

  it('ночь по Гринвичу — тот же день на фабрике', () => {
    const moment = new Date('2026-08-10T00:30:00Z'); // 03:30 МСК
    inEveryZone(() => {
      expect(factoryDate(moment)).toBe('2026-08-10');
    });
  });

  it('граница месяца', () => {
    inEveryZone(() => {
      expect(factoryDate(new Date('2026-08-31T22:00:00Z'))).toBe('2026-09-01');
      expect(factoryDate(new Date('2026-08-31T20:00:00Z'))).toBe('2026-08-31');
    });
  });

  it('однозначные месяц и день дополняются нулём', () => {
    inEveryZone(() => {
      expect(factoryDate(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
    });
  });
});

describe('factoryToday', () => {
  it('формат YYYY-MM-DD', () => {
    expect(factoryToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('это factoryDate от текущего момента', () => {
    expect(factoryToday()).toBe(factoryDate(new Date()));
  });

  it('одинаков в любом поясе машины', () => {
    const seen = new Set<string>();
    inEveryZone(() => { seen.add(factoryToday()); });
    expect(seen.size).toBe(1);
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
    inEveryZone(() => { expect(addDays(base, days)).toBe(want); });
  });
});

describe('diffDays — сколько суток между календарными днями', () => {
  it.each([
    ['2026-08-10', '2026-08-10', 0],
    ['2026-08-10', '2026-08-11', 1],
    ['2026-08-10', '2026-08-08', -2],
    ['2026-08-31', '2026-09-01', 1],
    ['2026-01-01', '2027-01-01', 365],
  ])('%s → %s = %i', (from, to, want) => {
    inEveryZone(() => { expect(diffDays(from, to)).toBe(want); });
  });
});

describe('monthBounds / monthDates', () => {
  it.each([
    ['2026-08-15', '2026-08-01', '2026-08-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-10', '2028-02-01', '2028-02-29'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
  ])('%s → %s … %s', (iso, from, to) => {
    inEveryZone(() => { expect(monthBounds(iso)).toEqual({ from, to }); });
  });

  it('даты месяца идут подряд и не выходят за границы', () => {
    inEveryZone(() => {
      const d = monthDates('2026-08-15');
      expect(d).toHaveLength(31);
      expect(d[0]).toBe('2026-08-01');
      expect(d[30]).toBe('2026-08-31');
    });
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
    inEveryZone(() => { expect(weekdayIndex(iso)).toBe(want); });
  });
});

describe('mondayOfWeek', () => {
  it('понедельник — сам себе понедельник', () => {
    // Ровно тот случай со скриншота заказчика: 10.08.2026 — понедельник,
    // а экран показывал неделю с субботы 08.08
    inEveryZone(() => { expect(mondayOfWeek('2026-08-10')).toBe('2026-08-10'); });
  });

  it.each([
    ['2026-08-11', '2026-08-10'],
    ['2026-08-14', '2026-08-10'],
    ['2026-08-16', '2026-08-10'], // воскресенье принадлежит УХОДЯЩЕЙ неделе
    ['2026-08-17', '2026-08-17'],
  ])('%s → %s', (iso, want) => {
    inEveryZone(() => { expect(mondayOfWeek(iso)).toBe(want); });
  });

  it('через границу месяца', () => {
    inEveryZone(() => { expect(mondayOfWeek('2026-09-02')).toBe('2026-08-31'); });
  });
});

describe('parseIsoDate — только для показа', () => {
  it('печатает свой календарный день в любом поясе машины', () => {
    // Местная полночь всегда попадает в свой же день, поэтому
    // toLocaleDateString напечатает «10 августа» везде
    inEveryZone(() => {
      expect(parseIsoDate('2026-08-10').getDate()).toBe(10);
      expect(parseIsoDate('2026-08-10').getMonth()).toBe(7);
    });
  });

  it('в factoryDate его результат подавать нельзя — и в коде так не делают', () => {
    // Круг «день → Date → день» восточнее Москвы вернул бы предыдущий день.
    // Проверяем не поведение, а отсутствие такого оборота в исходниках
    const hits = sources(SRC)
      .filter((f) => /factoryDate\(\s*parseIsoDate\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(hits).toEqual([]);
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
  const BAD = /toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/;

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
    expect(hits, `дата из UTC вместо factoryToday()/factoryDate(): ${hits.join(', ')}`).toEqual([]);
  });
});
