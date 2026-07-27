import { describe, it, expect } from 'vitest';
import {
  QUEUE_STEP,
  defaultQueuePosition,
  nextQueuePosition,
  renumberedQueue,
  reorderIds,
} from './queueOrder';

describe('defaultQueuePosition', () => {
  it('epoch срока клиента — порядок совпадает с сортировкой по сроку', () => {
    const a = defaultQueuePosition('2026-08-01');
    const b = defaultQueuePosition('2026-08-02');
    expect(a).toBe(Date.parse('2026-08-01T00:00:00Z') / 1000);
    expect(b - a).toBe(QUEUE_STEP);
  });

  it('без срока — в хвост очереди', () => {
    const now = new Date('2026-07-27T00:00:00Z');
    expect(defaultQueuePosition(null, now)).toBeGreaterThan(defaultQueuePosition('2027-01-01'));
  });

  it('битая дата не даёт NaN', () => {
    expect(Number.isFinite(defaultQueuePosition('не дата'))).toBe(true);
  });
});

describe('nextQueuePosition', () => {
  it('между соседями — середина', () => {
    expect(nextQueuePosition(100, 200)).toBe(150);
  });

  it('в начало очереди — на шаг выше первого', () => {
    expect(nextQueuePosition(null, 1000)).toBe(1000 - QUEUE_STEP);
  });

  it('в конец очереди — на шаг ниже последнего', () => {
    expect(nextQueuePosition(1000, null)).toBe(1000 + QUEUE_STEP);
  });

  it('пустая очередь — ноль', () => {
    expect(nextQueuePosition(null, null)).toBe(0);
    expect(nextQueuePosition(undefined, undefined)).toBe(0);
  });

  it('соседи слиплись по точности double — сигнал на перенумерацию', () => {
    const a = 1_800_000_000;
    // ULP в этом диапазоне — 2^-22: между a и следующим double середины не существует
    const ulp = 2 ** -22;
    expect(nextQueuePosition(a, a)).toBeNull();
    expect(nextQueuePosition(a, a + ulp)).toBeNull();
    // а через два ULP середина ещё есть — перенумерация не нужна
    expect(nextQueuePosition(a, a + ulp * 2)).toBe(a + ulp);
  });

  it('перевёрнутые соседи не дают позицию вне интервала', () => {
    expect(nextQueuePosition(200, 100)).toBeNull();
  });
});

describe('renumberedQueue', () => {
  it('равномерный шаг в порядке массива', () => {
    expect(renumberedQueue(['a', 'b', 'c'])).toEqual([
      { id: 'a', queue_position: 0 },
      { id: 'b', queue_position: QUEUE_STEP },
      { id: 'c', queue_position: QUEUE_STEP * 2 },
    ]);
  });

  it('пустая очередь', () => {
    expect(renumberedQueue([])).toEqual([]);
  });
});

describe('reorderIds', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('вставка после указанного соседа', () => {
    expect(reorderIds(ids, 'd', 'a', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('в начало очереди (соседа сверху нет)', () => {
    expect(reorderIds(ids, 'c', null, 'a')).toEqual(['c', 'a', 'b', 'd']);
  });

  it('в конец очереди (соседа снизу нет)', () => {
    expect(reorderIds(ids, 'a', 'd', null)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('перенос на место самого себя ничего не ломает', () => {
    expect(reorderIds(ids, 'b', 'a', 'c')).toEqual(ids);
  });

  it('соседи не найдены — элемент уходит в конец, но не теряется', () => {
    expect(reorderIds(ids, 'b', 'zzz', null)).toEqual(['a', 'c', 'd', 'b']);
  });
});
