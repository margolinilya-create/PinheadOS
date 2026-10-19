// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * CI: пересъёмка эталонов не узаконивает сдвиг ERP, смены обхода идут своим шагом
 * (веха 8, задача 9, К13 и К12). Сторож читает `.github/workflows/ci.yml`:
 *  - `workflow_dispatch` с `snapshots_grep` (по умолчанию `studio-`), пересъёмка — `--grep "$GREP"`;
 *  - шаг после коммита эталонов падает, если тронут хоть один не-`studio-` файл, — сам
 *    скрипт шага прогоняется во временном репозитории (мутация: изменённый `erp-*` → красный);
 *  - функциональная джоба — `--grep-invert "visual:|@walk"`, смены — `--grep @walk --project desktop`.
 */

const CI = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'ci.yml'), 'utf8');

/** Строки шага-сторожа из `ci.yml`: от `changed=$(` до закрывающего `fi` */
function guardScript(): string {
  const lines = CI.split('\n');
  const start = lines.findIndex((l) => l.includes('changed=$(git diff --name-only HEAD~1 HEAD -- e2e/visual.spec.ts-snapshots'));
  expect(start, 'в ci.yml нет шага-сторожа эталонов').toBeGreaterThan(0);
  const end = lines.findIndex((l, i) => i > start && l.trim() === 'fi');
  return lines.slice(start, end + 1).map((l) => l.trim()).join('\n');
}

/** Временный репозиторий: эталоны, коммит базы, затем коммит пересъёмки с `changed` файлами */
function runGuard(changed: string[], env: Record<string, string> = {}): number {
  const dir = mkdtempSync(join(tmpdir(), 'ci-visual-guard-'));
  try {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    git('config', 'user.email', 'ci@example.invalid');
    git('config', 'user.name', 'ci');
    const snaps = join(dir, 'e2e', 'visual.spec.ts-snapshots');
    mkdirSync(snaps, { recursive: true });
    for (const f of ['erp-orders-desktop.png', 'studio-sku-desktop.png', 'order-x-desktop.png']) writeFileSync(join(snaps, f), 'base');
    git('add', '.');
    git('commit', '-qm', 'base');
    for (const f of changed) writeFileSync(join(snaps, f), 'new');
    git('add', '.');
    git('commit', '-qm', 'snapshots', '--allow-empty');
    return spawnSync('bash', ['-e', '-c', guardScript()], {
      cwd: dir,
      stdio: 'pipe',
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    }).status ?? -1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ci.yml: эталоны и смены обхода', () => {
  it('пересъёмка — по snapshots_grep, по умолчанию studio-', () => {
    expect(CI).toMatch(/snapshots_grep:\n(?:\s+.*\n)*?\s+default: 'studio-'/);
    expect(CI).toContain(
      "GREP: ${{ (inputs.allow_erp_snapshots && (inputs.snapshots_grep == '' || inputs.snapshots_grep == 'studio-')) && 'erp-' || inputs.snapshots_grep || 'studio-' }}",
    );
    expect(CI).toContain('npx playwright test e2e/visual.spec.ts --update-snapshots --grep "$GREP"');
    expect(CI).not.toMatch(/--update-snapshots\s*$/m);
  });

  it('сторож стоит до push коммита эталонов', () => {
    const guard = CI.indexOf('changed=$(git diff --name-only HEAD~1 HEAD');
    expect(guard).toBeGreaterThan(CI.indexOf('git commit -m "test(visual): обновление эталонных скриншотов"'));
    expect(guard).toBeLessThan(CI.indexOf('git push origin HEAD:${{ github.ref_name }}'));
  });

  it('пересъёмка только studio- — шаг зелёный', () => {
    expect(runGuard(['studio-sku-desktop.png'])).toBe(0);
  });

  it('мутация: тронут erp-* — шаг красный', () => {
    expect(runGuard(['studio-sku-desktop.png', 'erp-orders-desktop.png'])).not.toBe(0);
  });

  it('флажок allow_erp_snapshots объявлен, по умолчанию выключен, и доходит до сторожа', () => {
    expect(CI).toMatch(/allow_erp_snapshots:\n(?:\s+.*\n)*?\s+default: false/);
    expect(CI).toContain('ALLOW_ERP: ${{ inputs.allow_erp_snapshots }}');
  });

  it('с флажком и snapshots_grep=erp- пересъёмка erp-* — шаг зелёный', () => {
    expect(runGuard(['erp-orders-desktop.png'], { ALLOW_ERP: 'true', GREP: 'erp-' })).toBe(0);
  });

  it('без флажка snapshots_grep=erp- не спасает: тронут erp-* — шаг красный', () => {
    expect(runGuard(['erp-orders-desktop.png'], { ALLOW_ERP: 'false', GREP: 'erp-' })).not.toBe(0);
  });

  it('с флажком эталон вне studio- и вне snapshots_grep — шаг красный', () => {
    expect(runGuard(['erp-orders-desktop.png', 'order-x-desktop.png'], { ALLOW_ERP: 'true', GREP: 'erp-' })).not.toBe(0);
  });

  it('смены @walk — своим шагом на desktop, функциональная джоба их не гоняет', () => {
    expect(CI).toContain('npx playwright test --grep-invert "visual:|@walk"');
    expect(CI).toContain('npx playwright test --grep @walk --project desktop');
  });
});
