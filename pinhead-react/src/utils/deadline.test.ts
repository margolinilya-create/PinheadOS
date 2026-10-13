// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { relative } from 'node:path';
import { deadlineTone, formatDeadlineShort, getDeadlineColor, getDeadlineInfo, getDeadlineLabel } from './deadline';
import { addDays, factoryToday, parseDateLocal, URGENT_DAYS } from './date';
import { readSource, sourceFiles, SRC_DIR } from '../testutil/sourceFiles';

/**
 * Срок Order Studio (обзор 26.09, п. 17): пороги — те же, что у ERP,
 * цвета — токены темы, а строка `YYYY-MM-DD` читается как местная полночь,
 * а не UTC (иначе западнее Гринвича печатался предыдущий день).
 *
 * Мутации (проверены 26.09): `new Date(deadline)` в `formatDeadlineShort` —
 * тест «полночь» красный в поясе UTC-3; hex вместо токена — красный.
 */
describe('deadline — срок заказа Order Studio', () => {
  afterEach(() => vi.useRealTimers());

  it('пороги совпадают с ERP: URGENT_DAYS и неделя', () => {
    const today = factoryToday();
    expect(deadlineTone(addDays(today, -1))).toBe('overdue');
    expect(deadlineTone(addDays(today, URGENT_DAYS))).toBe('urgent');
    expect(deadlineTone(addDays(today, URGENT_DAYS + 1))).toBe('soon');
    expect(deadlineTone(addDays(today, 8))).toBe('ok');
  });

  it('цвета — токены темы, не hex', () => {
    const today = factoryToday();
    for (const d of [addDays(today, -1), addDays(today, 1), addDays(today, 5), addDays(today, 30)]) {
      expect(getDeadlineInfo(d)?.color).toMatch(/^var\(--/);
      expect(getDeadlineColor(d)).toMatch(/^var\(--/);
    }
    expect(getDeadlineLabel(addDays(today, -2))).toBe('ПРОСРОЧЕН');
    expect(getDeadlineInfo(null)).toBeNull();
  });

  it('дата без времени показывается своим днём в любом поясе', () => {
    // Западнее Гринвича `new Date('2026-09-14')` — это 13-е сентября вечером
    const dt = parseDateLocal('2026-09-14')!;
    expect(dt.getDate()).toBe(14);
    expect(formatDeadlineShort('2026-09-14')).toMatch(/^14 /);
  });

  it('срок дальше недели подписан датой, а не числом дней', () => {
    const far = addDays(factoryToday(), 30);
    expect(getDeadlineInfo(far)?.label).toBe(formatDeadlineShort(far));
  });
});

/**
 * Сторож: срок (`deadline`, `due_date`, `planned_*`) не разбирается голым
 * `new Date(...)`. Полные ISO-метки (`created_at`) так читать можно — у них
 * есть время и пояс; у даты без времени — нет.
 */
describe('сроки не разбираются через new Date()', () => {
  it('в исходниках нет `new Date(<срок>)`', () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((p) => /new Date\([^)]*\b(deadline|due_date|planned_(start|end)|dl)\b[^)]*\)/.test(readSource(p)))
      .map((p) => relative(SRC_DIR, p));
    expect(offenders, 'строка YYYY-MM-DD через new Date() — это UTC; берите parseDateLocal').toEqual([]);
  });
});
