import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from '../erp/utils/migrations.testutil';

/**
 * СТЕНД СНИМКОВ НЕ ДОЛЖЕН СТАТЬ ЭТАЛОНОМ И НЕ ДОЛЖЕН ПОПАСТЬ В ГЕЙТ.
 *
 * Стенд (`e2e/bench/**`, `playwright.bench.config.ts`) снимает НАМЕРЕННО
 * ИСКАЖЁННУЮ страницу: оболочка разжимается (`unclamp.ts`), чтобы в кадр влез
 * весь экран, а не только первые 800 пикселей. Вида, который он снимает,
 * не видит ни один человек в проде. Узаконить такую картинку эталоном значит
 * сторожить то, что не отгружается, — и при этом сделать красным настоящий
 * сторож `visual.spec.ts`, у которого совсем другая задача.
 *
 * Три замка проверяются здесь, потому что каждый из них снимается ОДНОЙ
 * строкой правки и ни один не падает сам по себе: переименовал файл в
 * `*.spec.ts` — стенд молча поехал в `npm run e2e`; написал `toHaveScreenshot`
 * — молча появились эталоны, снятые не тем браузером; убрал `.shots` из
 * `.gitignore` — молча появился второй источник правды о правильном виде.
 *
 * Тест живёт в `src/`, а не в `e2e/`: vitest исключает `e2e/**` целиком
 * (тот же приём, что у `src/lib/e2eEnv.test.ts`).
 */

const ROOT = join(process.cwd());
const BENCH_DIR = join(ROOT, 'e2e', 'bench');
const BENCH_CONFIG = join(ROOT, 'playwright.bench.config.ts');
const MAIN_CONFIG = join(ROOT, 'playwright.config.ts');

function benchFiles(): string[] {
  return readdirSync(BENCH_DIR).filter((f) => f.endsWith('.ts'));
}

describe('стенд снимков отделён от визуальных эталонов', () => {
  it('файл обхода называется *.bench.ts — дефолтный testMatch Playwright его не видит', () => {
    const files = benchFiles();
    expect(files.length).toBeGreaterThan(0);
    // Дефолт Playwright: **/*.@(spec|test).?(c|m)[jt]s?(x). Основной конфиг
    // его не переопределяет, поэтому имя файла — первый и главный замок:
    // забыть про него нельзя, в отличие от строки в testIgnore
    const asSpec = files.filter((f) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(f));
    expect(asSpec, 'стенд не должен называться *.spec.ts / *.test.ts').toEqual([]);
  });

  it('обход снимает page.screenshot и не сравнивает с эталоном', () => {
    for (const file of benchFiles()) {
      const src = readFileSync(join(BENCH_DIR, file), 'utf8');
      expect(src, `${file}: toHaveScreenshot порождает эталоны`).not.toContain('toHaveScreenshot');
      expect(src, `${file}: toMatchSnapshot порождает эталоны`).not.toContain('toMatchSnapshot');
    }
    const shots = readFileSync(join(BENCH_DIR, 'shots.bench.ts'), 'utf8');
    expect(shots).toContain('page.screenshot(');
  });

  it('конфиг стенда глушит снимки-эталоны и держит свой каталог вывода', () => {
    const cfg = readFileSync(BENCH_CONFIG, 'utf8');
    expect(cfg).toMatch(/ignoreSnapshots:\s*true/);
    expect(cfg).toMatch(/testMatch:\s*\/\.\*\\\.bench\\\.ts\$\//);
    expect(cfg).toMatch(/testDir:\s*'\.\/e2e\/bench'/);
  });

  it('основной конфиг не подхватывает каталог стенда', () => {
    const cfg = readFileSync(MAIN_CONFIG, 'utf8');
    // testDir основного конфига — './e2e', и bench лежит внутри: защищает
    // только имя файла. Значит основной конфиг не имеет права расширять
    // testMatch до всех .ts — иначе первый замок перестаёт работать
    expect(cfg).not.toMatch(/testMatch:\s*\/\.\*\\\.ts\$\//);
    expect(cfg).not.toContain('bench');
  });

  it('вывод стенда лежит вне гита', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^\.shots\/$/m);
  });

  it('разжатие оболочки идёт по DOM, а не по хешированным именам классов', () => {
    // Комментарии снимаются ДО поиска: объяснение, почему такого селектора
    // здесь нет, содержит его же дословно — на этом сторож и упал в первом
    // прогоне. Тот же класс, что `withoutComments` у тестов миграций
    const src = withoutJsComments(readFileSync(join(BENCH_DIR, 'unclamp.ts'), 'utf8'));
    // Имена классов CSS-модулей хешируются; селектор по подстроке имени
    // держится на формате хеша, то есть на настройке сборщика, и в день
    // её смены стенд начнёт молча снимать первый экран вместо целого
    expect(src).not.toMatch(/class\*=/);
    expect(src).toContain("querySelector('main')");
  });

  it('каталог стенда существует и содержит матрицу состояний', () => {
    expect(existsSync(join(BENCH_DIR, 'routes.ts'))).toBe(true);
    expect(existsSync(join(BENCH_DIR, 'unclamp.ts'))).toBe(true);
  });
});
