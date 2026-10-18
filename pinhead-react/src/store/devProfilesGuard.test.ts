// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkNoDevProfiles } from '../../scripts/bundle-budget-m8.mjs';

/**
 * Подмена профиля dev-автологина не доезжает до людей (веха 8, задача 9, К12).
 *
 * Два сторожа. Исходники: `store/devProfiles.ts` подключается ТОЛЬКО динамическим
 * импортом из `store/devAutologin.ts` и только внутри `if (import.meta.env.DEV) {`;
 * ключ и маркер не живут нигде, кроме модуля (иначе ключ доехал бы до сборки чужим
 * файлом). Сборка: `checkNoDevProfiles` (зовёт `npm run bundle:budget`) — маркера,
 * ключа и чанка нет ни в одном js. Каждый проверен мутацией ниже.
 */

const SRC = join(process.cwd(), 'src');
const MODULE = 'store/devProfiles.ts';
const LOADER = 'store/devAutologin.ts';
const SIGNS = ['pinhead_dev_profile', '__PINHEAD_DEV_PROFILES__'];

function sources(dir = SRC, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) sources(abs, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\.[tj]sx?$/.test(name)) out[relative(SRC, abs)] = readFileSync(abs, 'utf8');
  }
  return out;
}

/** Нарушения в наборе исходников (`путь от src` → текст) */
function violations(files: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (path === MODULE) continue;
    if (/^\s*import\b[^;]*from\s+['"][^'"]*devProfiles['"]/m.test(text) || /^\s*export\b[^;]*from\s+['"][^'"]*devProfiles['"]/m.test(text)) {
      out.push(`${path}: статический импорт devProfiles`);
    }
    for (const sign of SIGNS) if (text.includes(sign)) out.push(`${path}: «${sign}» вне ${MODULE}`);
    const dyn = [...text.matchAll(/import\(\s*['"][^'"]*devProfiles['"]\s*\)/g)];
    for (const m of dyn) {
      if (path !== LOADER) { out.push(`${path}: динамический импорт devProfiles вне ${LOADER}`); continue; }
      const before = text.slice(0, m.index);
      const gate = before.lastIndexOf('if (import.meta.env.DEV) {');
      if (gate < 0) { out.push(`${path}: импорт devProfiles без защиты import.meta.env.DEV`); continue; }
      const between = before.slice(gate);
      const depth = (between.match(/{/g) ?? []).length - (between.match(/}/g) ?? []).length;
      if (depth <= 0) out.push(`${path}: импорт devProfiles вне блока import.meta.env.DEV`);
    }
  }
  return out;
}

describe('исходники: devProfiles только динамически и под DEV', () => {
  const files = sources();

  it('модуль и загрузчик на месте (сторож не сторожит пустоту)', () => {
    expect(files[MODULE]).toContain('__PINHEAD_DEV_PROFILES__');
    expect(files[LOADER]).toMatch(/import\(\s*'\.\/devProfiles'\s*\)/);
  });

  it('в дереве нарушений нет', () => {
    expect(violations(files)).toEqual([]);
  });

  it('мутация: статический импорт — красный', () => {
    const mutated = { ...files, [LOADER]: `import { devProfileFromStorage } from './devProfiles';\n${files[LOADER]}` };
    expect(violations(mutated).join('\n')).toMatch(/статический импорт/);
  });

  it('мутация: импорт без защиты DEV — красный', () => {
    const mutated = { ...files, [LOADER]: files[LOADER].replace('if (import.meta.env.DEV) {', 'if (true) {') };
    expect(violations(mutated).join('\n')).toMatch(/без защиты/);
  });

  it('мутация: импорт после закрытого блока DEV — красный', () => {
    const src = "if (import.meta.env.DEV) { x(); }\nconst m = await import('./devProfiles');";
    expect(violations({ [LOADER]: src }).join('\n')).toMatch(/вне блока/);
  });

  it('мутация: ключ хранилища в другом файле — красный', () => {
    const mutated = { ...files, 'App.jsx': `${files['App.jsx']}\nlocalStorage.getItem('pinhead_dev_profile');` };
    expect(violations(mutated).join('\n')).toMatch(/App\.jsx: «pinhead_dev_profile»/);
  });
});

describe('сборка: checkNoDevProfiles', () => {
  const run = (files: { name: string; text: string }[]) => {
    const errors: string[] = [];
    const ok = checkNoDevProfiles({ files, fail: (m: string) => errors.push(m) });
    return { ok, errors };
  };
  const clean = [{ name: 'assets/index-A1.js', text: 'console.log("dev-автологин")' }];

  it('чистая сборка — зелёный', () => {
    expect(run(clean)).toEqual({ ok: true, errors: [] });
  });

  it('маркер модуля в любом чанке — красный', () => {
    const r = run([...clean, { name: 'assets/index-B2.js', text: 'warn("x (__PINHEAD_DEV_PROFILES__)")' }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/__PINHEAD_DEV_PROFILES__/);
  });

  it('ключ хранилища — красный', () => {
    expect(run([{ name: 'assets/a.js', text: 'getItem("pinhead_dev_profile")' }]).ok).toBe(false);
  });

  it('чанк devProfiles — красный, даже без маркера', () => {
    expect(run([...clean, { name: 'assets/devProfiles-Cx9.js', text: '' }]).ok).toBe(false);
  });

  it('пустая сборка — красный (не пустота вместо проверки)', () => {
    expect(run([]).ok).toBe(false);
  });
});
