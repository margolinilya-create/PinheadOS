// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ИСТОРИЯ СЕССИЙ В `docs/sessions/` — СТОРОЖ ЦЕЛОСТНОСТИ (сессия 68).
 *
 * `SESSION-STATE.md` дорос до 7700 строк и 81 раздела «Состояние на …»:
 * заголовок обещал «история — в PROJECT.md», а файл хранил её сам, и текущее
 * состояние с открытыми долгами терялось под журналом. 24.09 разделы сессий
 * 66 и старше переехали в `docs/sessions/` по файлу на раздел, текст — дословно
 * (склейка частей сверена с исходником побайтно до записи).
 *
 * Сторож спрашивает три вещи — те же, что `rulesIndex.test.ts` у правил:
 *   1. указатель и файлы не разошлись (в обе стороны);
 *   2. в `SESSION-STATE.md` не копится история снова: разделов «Состояние
 *      на …» не больше `MAX_STATE_SECTIONS` — две последние сессии и запас
 *      на ту, что сейчас пишется;
 *   3. каждый перенесённый файл несёт заголовок раздела и непустое тело —
 *      усечённый файл выглядит как нормальный, пока его не открыть.
 */

const REPO = join(process.cwd(), '..');
const SESSIONS_DIR = join(REPO, 'docs', 'sessions');
const INDEX = join(SESSIONS_DIR, 'INDEX.md');
const STATE = join(REPO, 'SESSION-STATE.md');

const MAX_STATE_SECTIONS = 3;

describe('история сессий docs/sessions', () => {
  const index = readFileSync(INDEX, 'utf8');
  const files = readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.md') && f !== 'INDEX.md');

  it('перенос на месте: файлов не меньше, чем разделов на 24.09', () => {
    expect(files.length).toBeGreaterThanOrEqual(79);
  });

  it('каждый файл истории назван в указателе', () => {
    const missing = files.filter((f) => !index.includes(`\`${f}\``));
    expect(missing, `файлы есть, а в указателе их нет:\n${missing.join('\n')}`).toEqual([]);
  });

  it('каждая ссылка указателя ведёт в существующий файл', () => {
    const referenced = [...index.matchAll(/`([0-9a-z-]+\.md)`/g)].map((m) => m[1]);
    const dangling = [...new Set(referenced)].filter((f) => !files.includes(f));
    expect(dangling, `указатель обещает файлы, которых нет:\n${dangling.join('\n')}`).toEqual([]);
  });

  it('каждый файл — раздел «Состояние на …» с непустым телом', () => {
    for (const f of files) {
      const text = readFileSync(join(SESSIONS_DIR, f), 'utf8');
      expect(text.startsWith('## Состояние на '), `${f}: нет заголовка раздела`).toBe(true);
      const body = text.split('\n').slice(1).join('\n').replace(/-{3,}/g, '').trim();
      expect(body.length, `${f}: пустое тело — файл усечён?`).toBeGreaterThan(40);
    }
  });

  it('в SESSION-STATE.md не копится история', () => {
    const state = readFileSync(STATE, 'utf8');
    const sections = state.split('\n').filter((l) => l.startsWith('## Состояние на ')).length;
    expect(sections, 'перенесите старшие разделы в docs/sessions/ и впишите их в указатель')
      .toBeLessThanOrEqual(MAX_STATE_SECTIONS);
    expect(state).toContain('docs/sessions/INDEX.md');
  });
});
