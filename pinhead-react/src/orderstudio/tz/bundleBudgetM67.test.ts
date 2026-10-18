// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  checkTzLaunch, erpStoreFiles, ERP_STORE_MARKER, LAUNCH_BUDGET, M67_REQUIRED, TZ_PDF_BUDGET, WORKPLACE_BUDGET,
} from '../../../scripts/bundle-budget-m67.mjs';

/**
 * Стражи бюджета вехи 6+7 (`scripts/bundle-budget-m67.mjs`, задача 0). Сама сборка
 * проверяется `npm run bundle:budget`; здесь — что страж ловит на искусственном
 * манифесте: движок ТЗ в оболочке, стор ERP и вендоры на экране запуска, пропавший
 * подключённый модуль, превышение потолков. И чего не ловит: модулей ещё нет.
 */

type Chunk = { file: string; name?: string; src?: string; isEntry?: boolean; imports?: string[] };
type Manifest = Record<string, Chunk>;

function staticGraph(manifest: Manifest, roots: string[]) {
  const seen = new Set<string>();
  const js = new Set<string>();
  const walk = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    const c = manifest[k];
    if (!c) return;
    js.add(c.file);
    (c.imports ?? []).forEach(walk);
  };
  roots.forEach(walk);
  return { js: [...js], css: [] as string[] };
}

const minus = (files: string[], ...sets: string[][]) => files.filter((f) => !sets.some((s) => s.includes(f)));

/** Файлы в dist: имя → размер (содержимое из «x», gzip считает только report) */
function setup(opts: {
  sources?: Record<string, string>; manifest: Manifest; bodies?: Record<string, string>; sizes?: Record<string, number>; required?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), 'budget-m67-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  for (const c of Object.values(opts.manifest)) writeFileSync(join(dist, c.file), opts.bodies?.[c.file] ?? 'x');
  for (const [p, text] of Object.entries(opts.sources ?? {})) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  const errors: string[] = [];
  const checks: { label: string; actual: number; budget: number }[] = [];
  const findKey = (name: string, src: string) => Object.keys(opts.manifest).find((k) => k === src || opts.manifest[k].name === name);
  const sizeOf = (f: string) => opts.sizes?.[f] ?? 100;
  const ctx = {
    manifest: opts.manifest, root, dist, findKey, staticGraph, minus,
    fail: (m: string) => errors.push(m),
    report: (_t: string, files: string[]) => ({ total: files.reduce((n, f) => n + sizeOf(f), 0) }),
    check: (label: string, actual: number, budget: number) => {
      checks.push({ label, actual, budget });
      if (actual > budget) errors.push(`${label}: ${actual} > ${budget}`);
    },
    entryKey: 'index.html',
    orderAppKey: '_OrderStudioApp.js',
    workplaceKey: '_OrderWorkplace.js',
    // Режим «до задач T3/T6» по умолчанию: пропавший неподключённый модуль — пропуск
    m67Required: opts.required ?? false,
  };
  return { ctx, errors, checks, root, dist };
}

const BASE: Manifest = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_vendor-react.js'] },
  '_vendor-react.js': { file: 'assets/vendor-react.js' },
  '_OrderStudioApp.js': { file: 'assets/OrderStudioApp.js', name: 'OrderStudioApp', imports: ['index.html'] },
  '_OrderWorkplace.js': { file: 'assets/OrderWorkplace.js', name: 'OrderWorkplace', imports: ['index.html', '_labels.js'] },
  '_labels.js': { file: 'assets/labels.js' },
  '_vendor-pdf.js': { file: 'assets/vendor-pdf.js', name: 'vendor-pdf' },
  '_vendor-konva.js': { file: 'assets/vendor-konva.js', name: 'vendor-konva' },
  '_statusUi.js': { file: 'assets/statusUi.js', name: 'statusUi' },
};

function orderJs(m: Manifest) {
  return staticGraph(m, ['index.html', '_OrderStudioApp.js', '_OrderWorkplace.js']).js;
}

function run(opts: Parameters<typeof setup>[0]) {
  const s = setup(opts);
  const out = checkTzLaunch({ ...s.ctx, orderJs: orderJs(opts.manifest) });
  return { ...s, out };
}

describe('бюджет 6+7: до задач T3 и T6', () => {
  it('модулей ещё нет — зелёный, «Рабочее место» считается без входа и OrderStudioApp', () => {
    const { errors, out, checks } = run({ manifest: BASE });
    expect(errors).toEqual([]);
    expect(out.workplaceTotal).toBe(200);
    expect(out.tzPdfTotal).toBeNull();
    expect(out.launchTotal).toBeNull();
    expect(checks.map((c) => c.label)).toEqual(['Рабочее место, JS']);
  });

  it('исходник есть, экран его не подключил — пропуск, а не красный', () => {
    const { errors } = run({
      manifest: BASE,
      sources: {
        'src/orderstudio/tz/pdf/tzPdf.ts': 'export {}',
        'src/orderstudio/launch/LaunchScreen.jsx': 'export default 1',
        'src/orderstudio/OrderStudioApp.jsx': 'routes',
        'src/orderstudio/workplace/SummaryTab.jsx': 'tab',
      },
    });
    expect(errors).toEqual([]);
  });
});

describe('бюджет 6+7: после задачи 7 (M67_REQUIRED)', () => {
  it('флаг включён: все модули 6+7 подключены', () => {
    expect(M67_REQUIRED).toBe(true);
  });

  it('пропавший модуль — красный и без исходника, и неподключённый', () => {
    const { errors } = run({ manifest: BASE, required: true });
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toMatch(/tzPdf\.ts обязателен, но не найден в манифесте/);
    expect(errors.join('\n')).toMatch(/LaunchScreen\.jsx обязателен, но не найден в манифесте/);
  });
});

describe('бюджет 6+7: красный', () => {
  it('статический импорт tzPdf в SummaryTab (vendor-pdf в оболочке Order) — «ТЗ PDF в оболочке»', () => {
    const m: Manifest = { ...BASE, '_OrderWorkplace.js': { ...BASE['_OrderWorkplace.js'], imports: ['index.html', '_vendor-pdf.js'] } };
    const { errors } = run({ manifest: m });
    expect(errors.some((e) => e.startsWith('ТЗ PDF в оболочке'))).toBe(true);
  });

  it('у SummaryTab своя запись и в его графе vendor-pdf — красный', () => {
    const m: Manifest = { ...BASE, 'src/orderstudio/workplace/SummaryTab.jsx': { file: 'assets/SummaryTab.js', name: 'SummaryTab', imports: ['_vendor-pdf.js'] } };
    const { errors } = run({ manifest: m });
    expect(errors.some((e) => e.startsWith('ТЗ PDF в оболочке'))).toBe(true);
  });

  it('LaunchScreen подключён, а в манифесте нет — красный', () => {
    const { errors } = run({
      manifest: BASE,
      sources: {
        'src/orderstudio/launch/LaunchScreen.jsx': 'export default 1',
        'src/orderstudio/OrderStudioApp.jsx': "lazy(() => import('./launch/LaunchScreen'))",
      },
    });
    expect(errors).toEqual(['src/orderstudio/launch/LaunchScreen.jsx подключён, но не найден в манифесте — проверьте страж']);
  });

  it('tzPdf подключён через tzExport, а в манифесте нет — красный', () => {
    const { errors } = run({
      manifest: BASE,
      sources: {
        'src/orderstudio/tz/pdf/tzPdf.ts': 'export {}',
        'src/orderstudio/workplace/SummaryTab.jsx': "import { exportTz } from '../tz/ui/tzExport';",
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/tzPdf\.ts подключён/);
  });

  it('статический импорт стора ERP в LaunchScreen (литерал стора в графе) — красный', () => {
    const m: Manifest = { ...BASE, '_LaunchScreen.js': { file: 'assets/LaunchScreen.js', name: 'LaunchScreen', imports: ['index.html', '_statusUi.js'] } };
    const { errors } = run({ manifest: m, bodies: { 'assets/statusUi.js': `console.error("${ERP_STORE_MARKER}",e)` } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^стор ERP в статическом графе LaunchScreen \(assets\/statusUi\.js\)/);
  });

  it('стор ERP своей записью в графе LaunchScreen — красный', () => {
    const m: Manifest = {
      ...BASE,
      'src/erp/store/useErpStore.ts': { file: 'assets/useErpStore.js', src: 'src/erp/store/useErpStore.ts' },
      '_LaunchScreen.js': { file: 'assets/LaunchScreen.js', name: 'LaunchScreen', imports: ['src/erp/store/useErpStore.ts'] },
    };
    const { errors } = run({ manifest: m });
    expect(errors.some((e) => e.startsWith('стор ERP в статическом графе LaunchScreen'))).toBe(true);
  });

  it('vendor-pdf и vendor-konva в графе LaunchScreen — красный по каждому', () => {
    const m: Manifest = { ...BASE, '_LaunchScreen.js': { file: 'assets/LaunchScreen.js', name: 'LaunchScreen', imports: ['_vendor-pdf.js', '_vendor-konva.js'] } };
    const { errors } = run({ manifest: m });
    expect(errors.filter((e) => /^vendor-(pdf|konva) в статическом графе LaunchScreen/.test(e))).toHaveLength(2);
  });

  it('потолки: рабочее место, ТЗ PDF без vendor-pdf, экран запуска без входа и OrderStudioApp', () => {
    const m: Manifest = {
      ...BASE,
      '_tzPdf.js': { file: 'assets/tzPdf.js', name: 'tzPdf', imports: ['_vendor-pdf.js', '_labels.js'] },
      '_LaunchScreen.js': { file: 'assets/LaunchScreen.js', name: 'LaunchScreen', imports: ['index.html'] },
    };
    const sizes = {
      'assets/OrderWorkplace.js': WORKPLACE_BUDGET + 1,
      'assets/tzPdf.js': TZ_PDF_BUDGET + 1,
      'assets/vendor-pdf.js': 150_000,
      'assets/LaunchScreen.js': LAUNCH_BUDGET + 1,
      'assets/index.js': 999_999,
    };
    const { errors, out } = run({ manifest: m, sizes });
    expect(out.workplaceTotal).toBe(WORKPLACE_BUDGET + 1 + 100);
    expect(out.tzPdfTotal).toBe(TZ_PDF_BUDGET + 1);
    expect(out.launchTotal).toBe(LAUNCH_BUDGET + 1);
    expect(errors).toHaveLength(3);
  });
});

describe('бюджет 6+7: признак стора ERP', () => {
  it('литерал ловится в любом чанке, чистый чанк — нет', () => {
    const { dist } = setup({ manifest: BASE, bodies: { 'assets/statusUi.js': `x("${ERP_STORE_MARKER}")` } });
    expect(erpStoreFiles({ manifest: BASE, dist, files: ['assets/statusUi.js', 'assets/labels.js'] })).toEqual(['assets/statusUi.js']);
  });
});
