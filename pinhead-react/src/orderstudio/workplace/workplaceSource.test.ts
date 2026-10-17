// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож исходников рабочего места (веха 3, задача 5).
 *
 * - Рабочее место не пишет в `app_config`: каталог моделей правит админка,
 *   а не менеджер (у `SkuList` перетаскивание с записью каталога — `reorderable`).
 * - `useStore()` без селектора подписывает экран на ВЕСЬ стор визарда:
 *   любая правка буфера перерисовывала бы рабочее место целиком.
 */
const DIR = __dirname;
const GARMENT = join(DIR, '../../components/steps/garment');

const files = (dir: string) => readdirSync(dir)
  .filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f))
  .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }));

const NO_SELECTOR = /\buseStore\(\s*\)/;
const APP_CONFIG = /app_config/;

describe('рабочее место — исходники', () => {
  it('ни один файл рабочего места не упоминает app_config', () => {
    const bad = files(DIR).filter((f) => APP_CONFIG.test(f.text)).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('нет useStore() без селектора — ни в рабочем месте, ни в панелях визарда', () => {
    const bad = [...files(DIR), ...files(GARMENT)].filter((f) => NO_SELECTOR.test(f.text)).map((f) => f.name);
    expect(bad).toEqual([]);
  });

  it('самопроверка: образцы ловятся', () => {
    expect(NO_SELECTOR.test('const s = useStore();')).toBe(true);
    expect(NO_SELECTOR.test('useStore( )')).toBe(true);
    expect(NO_SELECTOR.test('useStore((s) => s.sku)')).toBe(false);
    expect(APP_CONFIG.test("from('app_config')")).toBe(true);
  });

  it('файлы рабочего места на месте', () => {
    const names = files(DIR).map((f) => f.name);
    for (const n of ['OrderWorkplace.jsx', 'ItemTab.jsx', 'GarmentPanel.jsx', 'ClientTab.jsx', 'SummaryTab.jsx', 'SaveIndicator.jsx']) {
      expect(names).toContain(n);
    }
  });
});
