import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURRENT_BUILD, VERSION_URL, fetchDeployedBuild, isNewerBuild, startVersionWatch,
} from './appVersion';
import { useAppUpdateStore, resetAppUpdateStore, SNOOZE_MS } from '../store/useAppUpdateStore';

/**
 * Проверка «вышло обновление» ДО первой сломанной кнопки.
 *
 * Снимки владельца 27.09: вкладка, открытая до выкатки, узнавала о ней
 * первым неудачным ленивым импортом. Здесь — вторая половина починки:
 * маркер сборки сверяется заранее, и плашка приходит до ошибки.
 */

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('маркер сборки', () => {
  it('зашит в код сборкой (define в vite.config.js)', () => {
    expect(typeof CURRENT_BUILD).toBe('string');
    expect(CURRENT_BUILD.length).toBeGreaterThan(0);
  });

  /**
   * Файл лежит ВНЕ `/assets/` и `/fonts/` — иначе service worker отдал бы его
   * из кеша «первый ответ навсегда», и вкладка никогда не увидела бы новую
   * сборку. Читаем сам `sw.js`: список префиксов живёт там.
   */
  it('version.json не попадает под кеш service worker', () => {
    const sw = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8');
    const m = /CACHED_PREFIXES\s*=\s*\[([^\]]*)\]/.exec(sw);
    expect(m, 'в sw.js нет CACHED_PREFIXES').not.toBeNull();
    const prefixes = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(prefixes.length).toBeGreaterThan(0);
    for (const p of prefixes) expect(VERSION_URL.startsWith(p)).toBe(false);
  });

  /**
   * Сборка пишет тот же маркер и в код, и в файл — из ОДНОЙ переменной.
   * Два независимых источника разошлись бы при первом же рефакторинге,
   * и плашка либо висела бы всегда, либо не появлялась никогда.
   */
  it('vite.config.js кладёт один и тот же buildId в define и в version.json', () => {
    const cfg = readFileSync(join(__dirname, '../../vite.config.js'), 'utf8');
    expect(cfg).toMatch(/define:\s*\{\s*__BUILD_ID__:\s*JSON\.stringify\(buildId\)/);
    expect(cfg).toMatch(/fileName:\s*'version\.json'.*JSON\.stringify\(\{\s*build:\s*buildId\s*\}\)/s);
  });
});

describe('fetchDeployedBuild', () => {
  it('читает маркер мимо кеша', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'abc' }));
    expect(await fetchDeployedBuild(fetchImpl)).toBe('abc');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith(VERSION_URL)).toBe(true);
    expect(init.cache).toBe('no-store');
  });

  /**
   * ОТРИЦАТЕЛЬНАЯ ПОЛОВИНА ВАЖНЕЕ: отказ сети, HTML вместо JSON (SPA-rewrite),
   * пустое тело — всё это «не знаем», а не «обновление». Иначе плашка
   * появлялась бы на каждом обрыве цехового Wi-Fi.
   */
  it.each([
    ['сеть упала', vi.fn(async () => { throw new TypeError('Failed to fetch'); })],
    ['не 200', vi.fn(async () => jsonResponse({ build: 'abc' }, false))],
    ['не JSON', vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response)],
    ['нет поля', vi.fn(async () => jsonResponse({}))],
    ['пустой маркер', vi.fn(async () => jsonResponse({ build: '' }))],
  ])('%s → null', async (_label, fetchImpl) => {
    expect(await fetchDeployedBuild(fetchImpl)).toBeNull();
  });
});

describe('isNewerBuild', () => {
  it('другой маркер — обновление', () => {
    expect(isNewerBuild('b', 'a')).toBe(true);
  });
  it.each([
    ['тот же маркер', 'a', 'a'],
    ['выложенный неизвестен', null, 'a'],
    ['текущий пуст (сборка без define)', 'b', ''],
  ])('%s — не обновление', (_label, deployed, current) => {
    expect(isNewerBuild(deployed, current)).toBe(false);
  });
});

describe('startVersionWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAppUpdateStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  }

  it('по таймеру видит новую сборку, ставит признак и останавливается', async () => {
    setVisibility('visible');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'new' }));
    const onUpdate = vi.fn();
    startVersionWatch({ enabled: true, intervalMs: 1000, onUpdate, fetchImpl, current: 'old' });

    expect(fetchImpl).not.toHaveBeenCalled(); // сразу после загрузки спрашивать нечего
    await vi.advanceTimersByTimeAsync(1000);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // после находки не опрашивает
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('по умолчанию пишет в useAppUpdateStore', async () => {
    setVisibility('visible');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'new' }));
    startVersionWatch({ enabled: true, intervalMs: 1000, fetchImpl, current: 'old' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(useAppUpdateStore.getState().available).toBe(true);
  });

  it('возврат вкладки на экран — проверка сразу', async () => {
    setVisibility('hidden');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'new' }));
    const onUpdate = vi.fn();
    startVersionWatch({ enabled: true, intervalMs: 60_000, onUpdate, fetchImpl, current: 'old' });

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('в фоне не опрашивает', async () => {
    setVisibility('hidden');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'new' }));
    startVersionWatch({ enabled: true, intervalMs: 1000, fetchImpl, current: 'old' });
    await vi.advanceTimersByTimeAsync(3500);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('та же сборка — молчит и продолжает опрашивать', async () => {
    setVisibility('visible');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'same' }));
    const onUpdate = vi.fn();
    startVersionWatch({ enabled: true, intervalMs: 1000, onUpdate, fetchImpl, current: 'same' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('остановка снимает таймер и слушатель', async () => {
    setVisibility('visible');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'new' }));
    const onUpdate = vi.fn();
    const stop = startVersionWatch({ enabled: true, intervalMs: 1000, onUpdate, fetchImpl, current: 'old' });
    stop();
    await vi.advanceTimersByTimeAsync(3000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('выключенный (dev) ничего не делает', async () => {
    setVisibility('visible');
    const fetchImpl = vi.fn(async () => jsonResponse({ build: 'new' }));
    startVersionWatch({ enabled: false, intervalMs: 1000, fetchImpl, current: 'old' });
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('useAppUpdateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAppUpdateStore();
  });
  afterEach(() => vi.useRealTimers());

  it('«Позже» прячет на время и возвращает сама', () => {
    useAppUpdateStore.getState().markAvailable();
    useAppUpdateStore.getState().snooze();
    expect(useAppUpdateStore.getState().snoozedUntil).toBeGreaterThan(0);
    vi.advanceTimersByTime(SNOOZE_MS - 1);
    expect(useAppUpdateStore.getState().snoozedUntil).toBeGreaterThan(0);
    vi.advanceTimersByTime(1);
    expect(useAppUpdateStore.getState().snoozedUntil).toBe(0);
    // Признак обновления «Позже» не снимает: другой сборки уже не будет
    expect(useAppUpdateStore.getState().available).toBe(true);
  });
});
