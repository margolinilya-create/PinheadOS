// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Сторож исходников рабочего места (веха 3, задача 5).
 *
 * - Рабочее место не пишет в `app_config`: каталог моделей правит админка,
 *   а не менеджер (перетаскивание `SkuList` с записью каталога убрано в вехе 4).
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

  /*
   * Веха 5а: холст — ленивый чанк. Рабочее место берёт из `design/` только
   * лёгкий признак «на холсте» (`design/model/layoutMark`, без zod) и сам
   * `DesignTab` — только через `import()`: статический импорт втянул бы konva,
   * zod и панель в оболочку Order (бюджет, Review Focus 5).
   */
  it('из модуля дизайна — только layoutMark статически и DesignTab через import()', () => {
    const DESIGN_STATIC = /from\s+['"]\.\.\/design\/([^'"]+)['"]/g;
    const bad = files(DIR).flatMap((f) => [...f.text.matchAll(DESIGN_STATIC)]
      .map((m) => m[1]).filter((p) => p !== 'model/layoutMark').map((p) => `${f.name}: ${p}`));
    expect(bad).toEqual([]);
    const wp = files(DIR).find((f) => f.name === 'OrderWorkplace.jsx')!.text;
    expect(wp).toMatch(/lazy\(\(\) => import\('\.\.\/design\/ui\/DesignTab'\)\)/);
    expect(readFileSync(join(DIR, '../design/model/layoutMark.ts'), 'utf8')).not.toMatch(/from\s+['"]zod/);
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
