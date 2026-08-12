/**
 * Кэш запросов: дедупликация, свежесть, инвалидация — и главное,
 * НЕПРОТЕКАНИЕ данных между сменами.
 *
 * Последнее и есть причина, по которой файл появился. `clearQueryCache()`
 * при выходе чистил карту, но ответ запроса, стартовавшего ДО выхода,
 * приходил после и клал значение обратно. Следующий человек за тем же
 * планшетом открывал тот же заказ и получал его из кэша, без сети —
 * с комментариями и историей предыдущего пользователя.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cachedQuery, invalidate, clearQueryCache, _cacheSize, _setClock,
  DEFAULT_TTL_MS, MAX_ENTRIES,
} from './queryCache';

/** Промис, который резолвится по внешней команде — «запрос в полёте» */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let clock = 0;

beforeEach(() => {
  clearQueryCache();
  clock = 1_000_000;
  _setClock(() => clock);
});

describe('утечка между сменами', () => {
  it('ответ, пришедший ПОСЛЕ выхода, не попадает в кэш', async () => {
    const d = deferred<string>();
    const fetcher = vi.fn(() => d.promise);

    // Смена 1 открыла заказ — запрос ушёл и ещё не вернулся
    const inFlight = cachedQuery('order:o1', fetcher);

    // Человек вышел из системы
    clearQueryCache();

    // Ответ приходит уже после выхода
    d.resolve('переписка смены 1');
    await expect(inFlight).resolves.toBe('переписка смены 1');

    expect(_cacheSize(), 'кэш обязан остаться пустым').toBe(0);

    // Смена 2 открывает тот же заказ — обязан уйти НОВЫЙ запрос
    const second = vi.fn(async () => 'данные смены 2');
    await expect(cachedQuery('order:o1', second)).resolves.toBe('данные смены 2');
    expect(second, 'смена 2 обязана сходить в сеть').toHaveBeenCalledTimes(1);
  });

  it('то же для пакета оболочки: роль и цех не достаются следующему', async () => {
    const d = deferred<{ role: string }>();
    const first = cachedQuery('erp:bootstrap', () => d.promise);
    clearQueryCache();
    d.resolve({ role: 'admin' });
    await first;

    const second = vi.fn(async () => ({ role: 'worker' }));
    await expect(cachedQuery('erp:bootstrap', second)).resolves.toEqual({ role: 'worker' });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('ответ, пришедший после инвалидации, не возвращает устаревшее в кэш', async () => {
    const d = deferred<string>();
    const stale = cachedQuery('order:o1', () => d.promise);

    invalidate('order:o1');       // прошла мутация — пакет устарел
    d.resolve('состояние ДО правки');
    await stale;

    expect(_cacheSize()).toBe(0);
    const after = vi.fn(async () => 'состояние ПОСЛЕ правки');
    await expect(cachedQuery('order:o1', after)).resolves.toBe('состояние ПОСЛЕ правки');
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('обычная работа не сломана', () => {
  it('свежий ответ отдаётся из кэша без запроса', async () => {
    const fetcher = vi.fn(async () => 'v1');
    await cachedQuery('k', fetcher);
    await cachedQuery('k', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('параллельные вызовы одного ключа делят один запрос', async () => {
    const d = deferred<string>();
    const fetcher = vi.fn(() => d.promise);
    const all = Promise.all(Array.from({ length: 50 }, () => cachedQuery('k', fetcher)));
    d.resolve('v');
    expect(await all).toEqual(Array(50).fill('v'));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('протухшее отдаётся сразу, обновление приходит в onRevalidated', async () => {
    await cachedQuery('k', async () => 'старое');
    clock += DEFAULT_TTL_MS + 1;

    const onRevalidated = vi.fn();
    const value = await cachedQuery('k', async () => 'новое', { onRevalidated });
    expect(value, 'экран не должен пустеть').toBe('старое');
    await new Promise((r) => setTimeout(r, 0));
    expect(onRevalidated).toHaveBeenCalledWith('новое');
  });

  it('invalidate по префиксу сносит только свою ветку', async () => {
    await cachedQuery('order:a:bundle', async () => 1);
    await cachedQuery('order:b:bundle', async () => 2);
    await cachedQuery('erp:bootstrap', async () => 3);

    invalidate('order:a:');
    expect(_cacheSize()).toBe(2);

    const refetch = vi.fn(async () => 11);
    await cachedQuery('order:a:bundle', refetch);
    expect(refetch).toHaveBeenCalledTimes(1);
    // Соседние ветки уцелели — запроса быть не должно
    const untouched = vi.fn(async () => 22);
    await cachedQuery('order:b:bundle', untouched);
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe('потолок записей', () => {
  it('кэш не растёт без границы', async () => {
    for (let i = 0; i < MAX_ENTRIES + 50; i += 1) {
      await cachedQuery(`k${i}`, async () => i);
    }
    expect(_cacheSize()).toBe(MAX_ENTRIES);
  });

  it('вытесняется самое давнее по ОБРАЩЕНИЮ, а не по вставке', async () => {
    for (let i = 0; i < MAX_ENTRIES; i += 1) {
      await cachedQuery(`k${i}`, async () => i);
    }
    // k0 — самый старый по вставке; трогаем его, он должен пережить вытеснение
    await cachedQuery('k0', async () => -1);

    await cachedQuery('новый', async () => 999);

    const k0 = vi.fn(async () => -2);
    await cachedQuery('k0', k0);
    expect(k0, 'k0 должен был остаться в кэше').not.toHaveBeenCalled();

    const k1 = vi.fn(async () => -3);
    await cachedQuery('k1', k1);
    expect(k1, 'k1 — самый давний, его и вытеснило').toHaveBeenCalledTimes(1);
  });
});
