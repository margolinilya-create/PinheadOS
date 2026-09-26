// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CHANGELOG В `docs/changelog/` — СТОРОЖ ЦЕЛОСТНОСТИ (обзор 26.09, сессия 69).
 *
 * `PROJECT.md` держал 106 записей сессий на 3865 строк из 3956 — тот же
 * журнал, что `docs/sessions/`, только третьим пересказом. Записи переехали
 * по файлу на месяц, текст дословно. Здесь — те же три вопроса, что
 * у `sessionsIndex.test.ts`: указатель и файлы не разошлись, в `PROJECT.md`
 * записи снова не копятся, каждый файл — настоящий журнал, а не огрызок.
 */

const REPO = join(process.cwd(), '..');
const DIR = join(REPO, 'docs', 'changelog');
const INDEX = join(DIR, 'INDEX.md');
const PROJECT = join(REPO, 'PROJECT.md');

describe('changelog docs/changelog', () => {
  const index = readFileSync(INDEX, 'utf8');
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'INDEX.md');

  it('файлы — по месяцу, и их не меньше, чем на 26.09', () => {
    for (const f of files) expect(f, 'имя файла — YYYY-MM.md').toMatch(/^\d{4}-\d{2}\.md$/);
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('каждый файл назван в указателе, каждая ссылка указателя ведёт в файл', () => {
    const missing = files.filter((f) => !index.includes(`\`${f}\``));
    expect(missing, `файлы есть, а в указателе их нет:\n${missing.join('\n')}`).toEqual([]);
    const referenced = [...index.matchAll(/`(\d{4}-\d{2}\.md)`/g)].map((m) => m[1]);
    const dangling = [...new Set(referenced)].filter((f) => !files.includes(f));
    expect(dangling, `указатель обещает файлы, которых нет:\n${dangling.join('\n')}`).toEqual([]);
  });

  it('каждый файл несёт заголовок месяца и хотя бы одну запись сессии', () => {
    let total = 0;
    for (const f of files) {
      const text = readFileSync(join(DIR, f), 'utf8');
      expect(text.startsWith('# Changelog — '), `${f}: нет заголовка`).toBe(true);
      const entries = text.split('\n').filter((l) => l.startsWith('### ')).length;
      expect(entries, `${f}: ни одной записи`).toBeGreaterThan(0);
      total += entries;
    }
    expect(total, 'перенос усечён: записей меньше, чем было в PROJECT.md').toBeGreaterThanOrEqual(106);
  });

  it('в PROJECT.md записи сессий не копятся снова', () => {
    const project = readFileSync(PROJECT, 'utf8');
    const changelog = project.slice(project.indexOf('## Changelog'), project.indexOf('## Статистика'));
    expect(changelog).toContain('docs/changelog/INDEX.md');
    expect(
      changelog.split('\n').filter((l) => l.startsWith('### ')),
      'запись сессии пишется в docs/changelog/<YYYY-MM>.md, а не сюда',
    ).toEqual([]);
  });
});
