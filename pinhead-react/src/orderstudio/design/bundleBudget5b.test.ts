// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBaseline, konvaFiles, normalizeText } from '../../../scripts/bundle-budget-5b.mjs';

/**
 * Стражи бюджета вехи 5б (`scripts/bundle-budget-5b.mjs`, задача 0). Сама сборка
 * проверяется `npm run bundle:budget` в CI; здесь — то, что страж обязан ловить
 * и чего не должен: хеш ленивого чанка и маркер сборки — не регрессия,
 * лишний байт во входе — регрессия.
 */
const BUILD = '2026-10-18T01:17:51.895Z';

function fixture(files: Record<string, string>, build = BUILD) {
  const root = mkdtempSync(join(tmpdir(), 'budget5b-'));
  const dist = join(root, 'dist');
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'version.json'), JSON.stringify({ build }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dist, name), text);
  return { root, dist };
}

function run(root: string, dist: string, files: string[], write = false) {
  const errors: string[] = [];
  const baseline = createBaseline({ root, dist, fail: (m: string) => errors.push(m), write });
  baseline.strict('entryJs', 'Вход, JS', files);
  baseline.done();
  return errors;
}

const ENTRY = 'import("./FlatsTab-C_Ujfb2_.js");const b="' + BUILD + '";';

describe('бюджет 5б: нормализация', () => {
  it('хеш имени чанка и ассета — в -HASH, маркер сборки — в BUILD', () => {
    expect(normalizeText('a("./FlatsTab-C_Ujfb2_.js","assets/x-AbCd-123.css")', null))
      .toBe('a("./FlatsTab-HASH.js","assets/x-HASH.css")');
    expect(normalizeText(ENTRY, BUILD)).toBe('import("./FlatsTab-HASH.js");const b="BUILD";');
  });

  it('не трогает слова без расширения файла', () => {
    expect(normalizeText('const flat-editor = 1; "-abcdefgh"', null)).toBe('const flat-editor = 1; "-abcdefgh"');
  });
});

describe('бюджет 5б: вход и оболочка против базы', () => {
  it('новый хеш ленивого чанка и другой маркер сборки — как в базе', () => {
    const a = fixture({ 'assets/index-Aa11Bb22.js': ENTRY });
    expect(run(a.root, a.dist, ['assets/index-Aa11Bb22.js'], true)).toEqual([]);
    const moved = ENTRY.replace('C_Ujfb2_', 'Zz9-xY8w').replace(BUILD, '000000000000');
    writeFileSync(join(a.dist, 'assets/index-Qq33Rr44.js'), moved);
    writeFileSync(join(a.dist, 'version.json'), JSON.stringify({ build: '000000000000' }));
    expect(run(a.root, a.dist, ['assets/index-Qq33Rr44.js'])).toEqual([]);
  });

  it('лишний байт во входе — красный с именем файла и разницей', () => {
    const a = fixture({ 'assets/index-Aa11Bb22.js': ENTRY });
    run(a.root, a.dist, ['assets/index-Aa11Bb22.js'], true);
    writeFileSync(join(a.dist, 'assets/index-Aa11Bb22.js'), `${ENTRY};`);
    const errors = run(a.root, a.dist, ['assets/index-Aa11Bb22.js']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('изменилось на 1 Б без сжатия');
    expect(errors[0]).toContain('assets/index-HASH.js');
  });

  it('новый файл в графе — красный', () => {
    const a = fixture({ 'assets/index-Aa11Bb22.js': ENTRY, 'assets/extra-Cc55Dd66.js': 'x' });
    run(a.root, a.dist, ['assets/index-Aa11Bb22.js'], true);
    const errors = run(a.root, a.dist, ['assets/index-Aa11Bb22.js', 'assets/extra-Cc55Dd66.js']);
    expect(errors[0]).toContain('+ assets/extra-HASH.js');
  });

  it('нет базы — красный, а не «зелёный по умолчанию»', () => {
    const a = fixture({ 'assets/index-Aa11Bb22.js': ENTRY });
    expect(run(a.root, a.dist, ['assets/index-Aa11Bb22.js'])[0]).toContain('нет базы');
  });

  it('база в репозитории снята на вход и оболочку ERP', () => {
    const saved = JSON.parse(readFileSync(join(process.cwd(), 'scripts/bundle-baseline.json'), 'utf8'));
    expect(Object.keys(saved.strict).sort()).toEqual(['entryJs', 'shellCss', 'shellJs']);
    expect(saved.strict.shellJs.raw).toBeGreaterThan(saved.strict.entryJs.raw);
  });
});

describe('бюджет 5б: konva в графе', () => {
  it('ловит vendor-konva и общий чанк design/ui/konva.ts', () => {
    const manifest = { 'src/orderstudio/design/ui/konva.ts': { file: 'assets/konva-Aa11Bb22.js' } };
    expect(konvaFiles(manifest, ['assets/vendor-konva-x.js', 'assets/konva-Aa11Bb22.js', 'assets/FlatsTab-y.js']))
      .toEqual(['assets/vendor-konva-x.js', 'assets/konva-Aa11Bb22.js']);
    expect(konvaFiles({}, ['assets/FlatsTab-y.js'])).toEqual([]);
  });
});

describe('бюджет 5б: подключение в bundle-budget.mjs', () => {
  const main = readFileSync(join(process.cwd(), 'scripts/bundle-budget.mjs'), 'utf8');
  const flats = readFileSync(join(process.cwd(), 'scripts/bundle-budget-5b.mjs'), 'utf8');

  it('вход и оболочка ERP сверяются с базой, проверки флэтов вызваны', () => {
    for (const key of ['entryJs', 'shellJs', 'shellCss']) expect(main).toContain(`baseline.strict('${key}'`);
    expect(main).toContain('checkFlatsAdmin(');
    expect(main).toContain('baseline.done()');
  });

  it('потолок редактора флэта и три корня без konva', () => {
    expect(flats).toMatch(/FLAT_EDITOR_BUDGET = 45_000/);
    for (const name of ['OrderSettings', 'FlatsTab', 'FlatPreview']) expect(flats).toContain(`['${name}', flatsKey(`);
  });
});
