// @vitest-environment node
/**
 * Сторожа модели ТЗ (веха 6+7, задача 2):
 *  1. `tz/model/**` — чистая модель: без React, сети, стора, ERP и `pricing/`
 *     (цена в ТЗ не попадает и модель не тянет формулу в граф рабочего места);
 *  2. чек-лист отправки не тянет раскладку и `fitText` (бюджет «Рабочего места»);
 *  3. в ТЗ нет цен: `tzDocument.ts` не читает полей цены, в документах фикстур
 *     нет ключей цены, себестоимости, маржи и скидки (К13).
 */
import { describe, it, expect } from 'vitest';
import { dirname, join, relative, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readSource, sourceFiles } from '../../../testutil/sourceFiles';
import { FIXTURE_NAMES, FIXTURE_OPTS, fixtureCatalogs, loadFixture } from '../../fixtures/loadFixture.testutil';
import { tzDocument } from './tzDocument';
import { tzGroups } from './tzGroups';

const DIR = join(process.cwd(), 'src/orderstudio/tz/model');
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm;

function importsOf(file: string): string[] {
  return [...readSource(file).matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  return ['.ts', '.tsx', '/index.ts'].map((e) => base + e).find(existsSync) ?? (existsSync(base) ? base : null);
}

/** Статический граф модуля внутри `tz/model` */
function localGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(f)) {
      const r = resolveLocal(f, spec);
      if (r && r.startsWith(DIR)) stack.push(r);
    }
  }
  return seen;
}

const FORBIDDEN: [RegExp, string][] = [
  [/(^|\/)pricing\//, 'pricing/'],
  [/^react($|\/)|^react-dom/, 'React'],
  [/lib\/supabase|(^|\/)api\/|(^|\/)store\//, 'сеть или стор'],
  [/(^|\/)erp\//, 'ERP'],
  [/(^|\/)screens\/|(^|\/)workplace\//, 'экраны'],
];

describe('tz/model — чистая модель', () => {
  const files = sourceFiles(DIR);

  it('модулей не меньше десяти (обход видит файлы)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(FORBIDDEN)('нет импорта %s', (re, what) => {
    const bad = files.flatMap((f) => importsOf(f).filter((s) => re.test(s)).map((s) => `${relative(DIR, f)} → ${s}`));
    expect(bad, `модель ТЗ импортирует ${what}`).toEqual([]);
  });

  it('чек-лист отправки не тянет раскладку и fitText', () => {
    const graph = [...localGraph(join(DIR, 'sendChecklist.ts'))].map((f) => relative(DIR, f));
    expect(graph).toContain('tzDocument.ts');
    expect(graph.filter((f) => /^(layout|fitText)/.test(f))).toEqual([]);
  });
});

const PRICE_KEY = /price|cost|margin|rub|discount|payment|sum$/i;

function priceKeys(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => priceKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (PRICE_KEY.test(k)) out.push(`${path}.${k}`);
      priceKeys(x, `${path}.${k}`, out);
    }
  }
}

describe('в ТЗ нет цен (К13)', () => {
  it('tzDocument.ts не читает полей цены позиции и заказа', () => {
    const src = readSource(join(DIR, 'tzDocument.ts')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(src).not.toMatch(/price_|unit_price|manual_unit_price|blank_price|discount|payments|minMargin|\bP\./);
  });

  it.each(FIXTURE_NAMES)('%s: в документе нет ключей цены', (name) => {
    const { order, group } = loadFixture(name);
    const doc = tzDocument(order, tzGroups(order)[group], fixtureCatalogs(), FIXTURE_OPTS);
    const found: string[] = [];
    priceKeys(doc, 'doc', found);
    expect(found).toEqual([]);
  });
});
