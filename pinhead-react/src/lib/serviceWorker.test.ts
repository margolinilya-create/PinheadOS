import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disableServiceWorker, isKillSwitch, setupServiceWorker, SW_URL } from './serviceWorker';

/**
 * Service worker живёт НА УСТРОЙСТВЕ и переживает выкатки — поэтому у него
 * два свойства, каждое из которых опаснее собственного отсутствия:
 *
 *  1. он может подменить код под уже открытой вкладкой (`skipWaiting`);
 *  2. выключить его снаружи нельзя — только с самого планшета.
 *
 * Тесты ниже сторожат оба. Половина из них читает `public/sw.js` как текст:
 * файл не проходит через сборку и не импортируется ниоткуда, поэтому ни один
 * обычный тест его не видит вовсе.
 */

const SW_SOURCE = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8');

/** Комментарии снимаем ДО поиска: объяснение «почему тут нет X» содержит X */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('sw.js — свойства, которые нельзя терять', () => {
  const code = withoutComments(SW_SOURCE);

  /**
   * `skipWaiting()` ставит новый worker под УЖЕ ОТКРЫТУЮ вкладку, которая
   * работает со старыми именами чанков. Первый же ленивый экран запросил бы
   * файл прошлой выкладки — то есть мы своими руками воспроизвели бы поломку,
   * которую лечит `lib/appUpdate`, ещё и без всякой выкатки.
   */
  it('не зовёт skipWaiting — иначе код подменится под открытой вкладкой', () => {
    expect(code).not.toContain('skipWaiting');
  });

  it('обрабатывает только GET', () => {
    expect(code).toMatch(/request\.method\s*!==\s*'GET'/);
  });

  it('не вмешивается в чужие домены — Supabase идёт мимо', () => {
    expect(code).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
  });

  /**
   * Без выключателя сломанный worker на планшете чинится только через
   * «очистить данные сайта» в настройках браузера — то есть не чинится.
   */
  it('пропускает адрес аварийного выключателя в сеть', () => {
    expect(code).toMatch(/searchParams\.get\('sw'\)\s*===\s*'off'/);
  });

  /**
   * Каждая выкатка добавляет НОВЫЕ имена файлов; без обрезки кеш растёт
   * до бесконечности на устройстве, к которому никто не подойдёт.
   */
  it('обрезает кеш ассетов', () => {
    expect(code).toContain('ASSET_LIMIT');
    expect(code).toMatch(/cache\.delete\(keys\[/);
  });

  /**
   * Ответы Supabase не кешируются: выборка зависит от вошедшего, а планшет
   * в цеху общий. Кеш чужой выборки — ровно то, против чего написаны
   * `resetErpStore()` и `storageClearAll()`.
   */
  it('кеширует только код и шрифты', () => {
    expect(code).toMatch(/CACHED_PREFIXES\s*=\s*\['\/assets\/',\s*'\/fonts\/'\]/);
  });
});

describe('isKillSwitch', () => {
  it('узнаёт ?sw=off', () => {
    expect(isKillSwitch('?sw=off')).toBe(true);
    expect(isKillSwitch('?studio=0&sw=off')).toBe(true);
  });

  it('другие значения выключателем не считаются', () => {
    expect(isKillSwitch('')).toBe(false);
    expect(isKillSwitch('?sw=on')).toBe(false);
    expect(isKillSwitch('?swagger=off')).toBe(false);
  });
});

describe('setupServiceWorker', () => {
  const register = vi.fn(() => Promise.resolve({} as ServiceWorkerRegistration));
  const unregister = vi.fn(() => Promise.resolve(true));
  const getRegistrations = vi.fn(() => Promise.resolve([{ unregister }]));
  const cachesDelete = vi.fn(() => Promise.resolve(true));

  beforeEach(() => {
    register.mockClear();
    unregister.mockClear();
    cachesDelete.mockClear();
    vi.stubGlobal('navigator', { serviceWorker: { register, getRegistrations } });
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['pinhead-shell-v1', 'чужой-кеш']),
      delete: cachesDelete,
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  /** `load` уже прошёл к моменту вызова в тестовой среде — дёргаем событие сами */
  function fireLoad() {
    window.dispatchEvent(new Event('load'));
  }

  it('в собранном приложении регистрирует worker после load', () => {
    setupServiceWorker(true);
    expect(register, 'регистрация не должна соревноваться за сеть с первым экраном')
      .not.toHaveBeenCalled();
    fireLoad();
    expect(register).toHaveBeenCalledWith(SW_URL);
  });

  it('в dev-режиме не регистрирует ничего', () => {
    // Модули отдаёт Vite с горячей заменой, и кеширующий worker сломал бы
    // разработку; заодно поэтому его не видит ни один существующий e2e
    setupServiceWorker(false);
    fireLoad();
    expect(register).not.toHaveBeenCalled();
  });

  it('?sw=off снимает регистрацию, даже когда worker включён', async () => {
    const search = window.location.search;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?sw=off' }, writable: true, configurable: true,
    });
    setupServiceWorker(true);
    fireLoad();
    expect(register, 'выключатель обязан работать сильнее включения').not.toHaveBeenCalled();
    await vi.waitFor(() => expect(unregister).toHaveBeenCalled());
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search }, writable: true, configurable: true,
    });
  });

  it('выключатель стирает наши кеши и не трогает чужие', async () => {
    await disableServiceWorker();
    expect(unregister).toHaveBeenCalled();
    expect(cachesDelete).toHaveBeenCalledWith('pinhead-shell-v1');
    expect(cachesDelete).not.toHaveBeenCalledWith('чужой-кеш');
  });

  it('браузер без service worker не роняет запуск', () => {
    vi.stubGlobal('navigator', {});
    expect(() => setupServiceWorker(true)).not.toThrow();
  });
});
