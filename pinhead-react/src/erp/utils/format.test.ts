import { describe, it, expect } from 'vitest';
import {
  percentLabel,
  dueLabel,
  dueLabelCompact,
  overdueBucket,
  OVERDUE_BUCKET_SHORT,
  percentOf,
  formatPercent,
  formatDateTimeShort,
  formatDateCell,
  formatDayMonth,
} from './format';

describe('dueLabel — прозаическая метка срока', () => {
  it('сегодня и завтра словами, а не «через 0 дн.»', () => {
    expect(dueLabel(0)).toBe('сегодня');
    expect(dueLabel(1)).toBe('завтра');
  });

  it('будущее — «через N дн.»', () => {
    expect(dueLabel(2)).toBe('через 2 дн.');
    expect(dueLabel(30)).toBe('через 30 дн.');
  });

  it('прошлое — «просрочен N дн.», всегда с точкой и со словом', () => {
    expect(dueLabel(-1)).toBe('просрочен 1 дн.');
    expect(dueLabel(-47)).toBe('просрочен 47 дн.');
  });

  it('срока нет — говорим об этом, а не молчим', () => {
    expect(dueLabel(null)).toBe('срок не задан');
    expect(dueLabel(undefined)).toBe('срок не задан');
  });
});

describe('dueLabelCompact — плотная метка', () => {
  it('слово «просрочен» сохраняется: минус в потоке цифр читается как дефис', () => {
    expect(dueLabelCompact(-5)).toBe('просрочен 5 дн.');
    expect(dueLabelCompact(-5)).not.toContain('−');
  });

  it('срок в будущем — только число с единицей', () => {
    expect(dueLabelCompact(0)).toBe('0 дн.');
    expect(dueLabelCompact(12)).toBe('12 дн.');
  });

  it('срока нет — прочерк, а не пустота', () => {
    expect(dueLabelCompact(null)).toBe('—');
  });
});

describe('overdueBucket — ступени просрочки', () => {
  it('граница недели: 7 включительно', () => {
    expect(overdueBucket(1)).toBe('week');
    expect(overdueBucket(7)).toBe('week');
    expect(overdueBucket(8)).toBe('month');
  });

  it('граница месяца: 30 включительно', () => {
    expect(overdueBucket(30)).toBe('month');
    expect(overdueBucket(31)).toBe('stale');
  });

  it('не просрочен — отдельная ступень, не «до недели»', () => {
    expect(overdueBucket(0)).toBe('none');
    expect(overdueBucket(-3)).toBe('none');
  });

  it('у каждой ступени есть короткая подпись', () => {
    for (const b of ['none', 'week', 'month', 'stale'] as const) {
      expect(OVERDUE_BUCKET_SHORT[b]).toBeTruthy();
    }
  });

  it('боевая раскладка 03.08.2026 разносится 6 / 39 / 2', () => {
    // Ровно тот случай, ради которого ступени и заведены: 47 «просрочено»
    // одним числом ничего не говорят, а по ступеням горят шесть.
    const days = [
      ...Array(6).fill(3),    // 1–7
      ...Array(39).fill(15),  // 8–30
      ...Array(2).fill(40),   // 30+
    ];
    const counts = days.reduce<Record<string, number>>((acc, d) => {
      const b = overdueBucket(d);
      acc[b] = (acc[b] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ week: 6, month: 39, stale: 2 });
  });
});

describe('percentOf — ноль в знаменателе это «неизвестно», а не «готово»', () => {
  it('план ноль → null, а НЕ 100', () => {
    expect(percentOf(0, 0)).toBeNull();
    expect(percentOf(5, 0)).toBeNull();
    expect(percentOf(0, -1)).toBeNull();
  });

  it('обычный расчёт с округлением', () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(2, 3)).toBe(67);
    expect(percentOf(50, 100)).toBe(50);
  });

  it('перевыполнение упирается в 100, недостача не уходит ниже 0', () => {
    expect(percentOf(150, 100)).toBe(100);
    expect(percentOf(-5, 100)).toBe(0);
  });

  it('строкой: нет базы → прочерк', () => {
    expect(percentLabel(null)).toBe('—');
    expect(percentLabel(undefined)).toBe('—');
    expect(percentLabel(0)).toBe('0%');
    expect(formatPercent(0, 0)).toBe('—');
    expect(formatPercent(3, 4)).toBe('75%');
  });
});

describe('форматирование дат — короткая дата не должна съезжать на сутки', () => {
  it('YYYY-MM-DD печатается тем же днём (достраивается до локальной полуночи)', () => {
    // `new Date('2026-08-14')` — это UTC-полночь; западнее Гринвича
    // без достройки печаталось 13.08. Прежний screens/orderCard/format.js
    // делал ровно так.
    expect(formatDateCell('2026-08-14')).toBe('14.08.2026');
    expect(formatDayMonth('2026-08-14')).toBe('14.08');
  });

  it('полный ISO с временем разбирается как есть', () => {
    const out = formatDateTimeShort('2026-08-14T09:30:00');
    expect(out).toContain('14.08');
    expect(out).toContain('09:30');
  });

  it('пусто и мусор → прочерк, а не «Invalid Date»', () => {
    expect(formatDateCell(null)).toBe('—');
    expect(formatDateCell('')).toBe('—');
    expect(formatDateTimeShort('не дата')).toBe('—');
    expect(formatDayMonth(undefined)).toBe('');
  });
});
