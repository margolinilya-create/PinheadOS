import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cachedQuery,
  invalidate,
  clearQueryCache,
  _setClock,
  _cacheSize,
} from './queryCache';

/**
 * Кэш решает три задачи, и у каждой свой тест: дедупликация параллельных
 * вызовов, отдача протухшего немедленно с фоновым обновлением, инвалидация
 * после мутации. Четвёртое свойство — чистка при выходе — проверяется здесь же:
 * на общем цеховом планшете кэш прошлого работника это утечка его данных.
 */

let clock = 1_000_000;
beforeEach(() => {
  clearQueryCache();
  clock = 1_000_000;
  _setClock(() => clock);
});

describe('дедупликация', () => {
  it('параллельные вызовы с одним ключом делят один запрос', async () => {
    const fetcher = vi.fn().mockResolvedValue('данные');
    const [a, b, c] = await Promise.all([
      cachedQuery('k', fetcher),
      cachedQuery('k', fetcher),
      cachedQuery('k', fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['данные', 'данные', 'данные']);
  });

  it('разные ключи не смешиваются', async () => {
    const f1 = vi.fn().mockResolvedValue(1);
    const f2 = vi.fn().mockResolvedValue(2);
    expect(await cachedQuery('a', f1)).toBe(1);
    expect(await cachedQuery('b', f2)).toBe(2);
  });
});

describe('свежесть и stale-while-revalidate', () => {
  it('в пределах TTL запрос не повторяется', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    await cachedQuery('k', fetcher, { ttlMs: 1000 });
    clock += 500;
    await cachedQuery('k', fetcher, { ttlMs: 1000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('после TTL отдаёт СТАРОЕ сразу и обновляет фоном', async () => {
    // Явный тип: без него vi.fn() выводится как () => unknown, и колбэк
    // ревалидации получает unknown вместо строки.
    const fetcher = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce('старое')
      .mockResolvedValueOnce('новое');
    await cachedQuery('k', fetcher, { ttlMs: 1000 });
    clock += 2000;

    const revalidated: string[] = [];
    // Экран не должен мигать скелетоном на данных, которые уже видели
    const shown = await cachedQuery('k', fetcher, {
      ttlMs: 1000,
      onRevalidated: (v) => revalidated.push(v),
    });
    expect(shown).toBe('старое');
    await vi.waitFor(() => expect(revalidated).toEqual(['новое']));

    // Следующий вызов уже отдаёт обновлённое
    expect(await cachedQuery('k', fetcher, { ttlMs: 1000 })).toBe('новое');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('ttlMs=0 перезапрашивает всегда, но дедупликацию сохраняет', async () => {
    const fetcher = vi.fn().mockResolvedValue('v');
    await Promise.all([cachedQuery('k', fetcher, { ttlMs: 0 }), cachedQuery('k', fetcher, { ttlMs: 0 })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await cachedQuery('k', fetcher, { ttlMs: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('ошибки', () => {
  it('провалившийся запрос не оседает в кэше', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('сеть'));
    await expect(cachedQuery('k', fetcher)).rejects.toThrow('сеть');
    expect(_cacheSize()).toBe(0);
    // Следующая попытка обязана уйти в сеть, а не вернуть «ничего»
    fetcher.mockResolvedValueOnce('ок');
    expect(await cachedQuery('k', fetcher)).toBe('ок');
  });
});

describe('инвалидация', () => {
  it('сбрасывает по префиксу, не задевая чужие ключи', async () => {
    const a = vi.fn().mockResolvedValue('A1');
    const b = vi.fn().mockResolvedValue('B1');
    await cachedQuery('erp:order-detail:1', a);
    await cachedQuery('erp:bootstrap', b);

    invalidate('erp:order-detail:');
    a.mockResolvedValue('A2');
    expect(await cachedQuery('erp:order-detail:1', a)).toBe('A2');
    // Бутстрап не трогали — второго запроса быть не должно
    expect(await cachedQuery('erp:bootstrap', b)).toBe('B1');
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('полная очистка убирает всё — это выход из системы', async () => {
    await cachedQuery('erp:bootstrap', vi.fn().mockResolvedValue(1));
    await cachedQuery('erp:order-detail:1', vi.fn().mockResolvedValue(2));
    expect(_cacheSize()).toBe(2);
    clearQueryCache();
    expect(_cacheSize()).toBe(0);
  });
});
