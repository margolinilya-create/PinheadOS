// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  checkRestyle, EDITOR_BUDGETS, ORDER_SHELL_CSS_BUDGET, ORDER_SHELL_JS_BUDGET,
} from '../../scripts/bundle-budget-m8.mjs';

/**
 * Стражи бюджета вехи 8 (`scripts/bundle-budget-m8.mjs`, задача 0): «Оболочка Order»
 * JS/CSS и графы «Справочник моделей» / «Экспресс». Сама сборка проверяется
 * `npm run bundle:budget`; здесь — что страж считает и ловит на искусственном манифесте.
 */

type Chunk = { file: string; name?: string; isEntry?: boolean; imports?: string[]; css?: string[] };
type Manifest = Record<string, Chunk>;

function staticGraph(manifest: Manifest, roots: string[]) {
  const seen = new Set<string>();
  const js = new Set<string>();
  const css = new Set<string>();
  const walk = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    const c = manifest[k];
    if (!c) return;
    js.add(c.file);
    (c.css ?? []).forEach((f) => css.add(f));
    (c.imports ?? []).forEach(walk);
  };
  roots.forEach(walk);
  return { js: [...js], css: [...css] };
}

const BASE: Manifest = {
  'index.html': { file: 'assets/index.js', isEntry: true, css: ['assets/index.css'] },
  '_OrderStudioApp.js': { file: 'assets/OrderStudioApp.js', name: 'OrderStudioApp', imports: ['index.html'], css: ['assets/OrderStudioApp.css'] },
  '_OrderWorkplace.js': { file: 'assets/OrderWorkplace.js', name: 'OrderWorkplace', imports: ['index.html'] },
  'src/components/editors/SkuEditor.jsx': { file: 'assets/SkuEditor.js', name: 'SkuEditor', imports: ['index.html', '_zones.js'] },
  '_zones.js': { file: 'assets/zones.js' },
  'src/components/editors/ExpressCalc.jsx': { file: 'assets/ExpressCalc.js', name: 'ExpressCalc', imports: ['_OrderStudioApp.js'] },
};

function run(manifest: Manifest, sizes: Record<string, number> = {}) {
  const errors: string[] = [];
  const checks: Record<string, { actual: number; budget: number }> = {};
  const totals = checkRestyle({
    manifest,
    staticGraph,
    findKey: (name: string, src: string) => Object.keys(manifest).find((k) => k === src || manifest[k].name === name),
    fail: (m: string) => errors.push(m),
    report: (_t: string, files: string[]) => ({ total: files.reduce((n, f) => n + (sizes[f] ?? 100), 0) }),
    check: (label: string, actual: number, budget: number) => {
      checks[label] = { actual, budget };
      if (actual > budget) errors.push(`${label}: ${actual} > ${budget}`);
    },
    entryKey: 'index.html',
    orderAppKey: '_OrderStudioApp.js',
    workplaceKey: '_OrderWorkplace.js',
  });
  return { errors, checks, totals };
}

describe('бюджет вехи 8: оболочка Order и редакторы', () => {
  it('потолки = замер задачи 0 + 2 % (оболочка) и + 5 % (редакторы, с их долей глобального CSS)', () => {
    expect(ORDER_SHELL_JS_BUDGET).toBe(Math.round(282_993 * 1.02));
    expect(ORDER_SHELL_CSS_BUDGET).toBe(Math.round(46_874 * 1.02));
    expect(EDITOR_BUDGETS.SkuEditor.budget).toBe(Math.round((23_783 + 9_513) * 1.05));
    expect(EDITOR_BUDGETS.ExpressCalc.budget).toBe(Math.round((3_832 + 1_914) * 1.05));
  });

  it('оболочка Order = вход + OrderStudioApp + OrderWorkplace, JS и CSS отдельно', () => {
    const { checks, errors } = run(BASE);
    expect(errors).toEqual([]);
    expect(checks['Оболочка Order, JS'].actual).toBe(300);
    expect(checks['Оболочка Order, CSS'].actual).toBe(200);
  });

  it('редактор считается без оболочки Order: JS и свой CSS вместе', () => {
    const manifest: Manifest = {
      ...BASE,
      'src/components/editors/SkuEditor.jsx': { ...BASE['src/components/editors/SkuEditor.jsx'], css: ['assets/SkuEditor.css'] },
    };
    const { checks } = run(manifest);
    // SkuEditor.js + zones.js + SkuEditor.css; index.js и index.css — в оболочке
    expect(checks['Справочник моделей, JS+CSS'].actual).toBe(300);
    // ExpressCalc.js; OrderStudioApp — в оболочке
    expect(checks['Экспресс, JS+CSS'].actual).toBe(100);
  });

  it('рост сверх потолка — красный (мутация: CSS-модуль редактора тяжелее удалённого глобального)', () => {
    const manifest: Manifest = {
      ...BASE,
      'src/components/editors/ExpressCalc.jsx': { ...BASE['src/components/editors/ExpressCalc.jsx'], css: ['assets/ExpressCalc.css'] },
    };
    const { errors } = run(manifest, { 'assets/ExpressCalc.css': EDITOR_BUDGETS.ExpressCalc.budget });
    expect(errors.join('\n')).toMatch(/Экспресс, JS\+CSS/);
  });

  it('оболочка Order тяжелее потолка — красный', () => {
    const { errors } = run(BASE, { 'assets/OrderWorkplace.js': ORDER_SHELL_JS_BUDGET });
    expect(errors.join('\n')).toMatch(/Оболочка Order, JS/);
  });

  it('пропавший из манифеста редактор — красный, а не пропуск', () => {
    const manifest = { ...BASE };
    delete manifest['src/components/editors/SkuEditor.jsx'];
    const { errors } = run(manifest);
    expect(errors.join('\n')).toMatch(/SkuEditor/);
  });
});
