// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ПЕРЕНОС ПРАВИЛ В `docs/rules/` — СТОРОЖ ЦЕЛОСТНОСТИ.
 *
 * 15.09 шестьдесят журнальных секций уехали из корневого `CLAUDE.md`
 * в `docs/rules/` (~136k токенов, которые до того читались ЦЕЛИКОМ на каждом
 * запросе любой сессии). Перенос механический, текст не менялся ни одним
 * символом — но именно такие правки ломаются молча: у проекта уже был случай,
 * когда `open(p,'w')` усёк файл, а сборка, бюджет и тесты остались зелёными.
 *
 * Сторож спрашивает три вещи:
 *   1. указатель и файлы не разошлись (в обе стороны);
 *   2. в корне не осталось журнальных секций — иначе перенос сделан наполовину
 *      и правило живёт в двух местах;
 *   3. каждый перенесённый файл несёт заголовок и непустое тело — усечённый
 *      файл выглядит как нормальный, пока его не открыть.
 *
 * Чего он НЕ проверяет и это надо сказать вслух: совпадения текста с тем, что
 * было ДО переноса. Исходника больше нет, а хранить его копию ради сверки —
 * это второй источник правды, то самое, от чего перенос и делался. Побайтовая
 * сверка выполнена в момент переноса, скриптом, до записи корневого файла.
 */

const REPO = join(process.cwd(), '..');
const RULES_DIR = join(REPO, 'docs', 'rules');
const INDEX = join(RULES_DIR, 'INDEX.md');
const ROOT_CLAUDE = join(REPO, 'CLAUDE.md');

/** Карта подсистем React-приложения — тот же перенос, второй этаж */
const REACT_DIR = join(RULES_DIR, 'react');
const REACT_INDEX = join(REACT_DIR, 'INDEX.md');
const NESTED_CLAUDE = join(process.cwd(), 'CLAUDE.md');

describe('указатель правил docs/rules', () => {
  const index = readFileSync(INDEX, 'utf8');
  const files = readdirSync(RULES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'INDEX.md')
    .map((e) => e.name);

  it('каждый файл правил назван в указателе', () => {
    const missing = files.filter((f) => !index.includes(f));
    expect(
      missing,
      `файлы есть, а в указателе их нет — найти их можно только грепом:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  it('каждая ссылка указателя ведёт в существующий файл', () => {
    const referenced = [...index.matchAll(/`([a-z0-9-]+\.md)`/g)].map((m) => m[1]);
    const dangling = [...new Set(referenced)].filter((f) => !files.includes(f));
    expect(
      dangling,
      `указатель обещает файлы, которых нет:\n${dangling.join('\n')}`,
    ).toEqual([]);
  });

  it('в корневом CLAUDE.md не осталось журнальных секций', () => {
    const root = readFileSync(ROOT_CLAUDE, 'utf8');
    // Заголовки вида «## Правила … (сессия N)» / «(дата)» — это и есть журнал
    const left = [...root.matchAll(/^## (Правила [^\n]*)$/gm)]
      .map((m) => m[1])
      // «Правила кода» и «Правила и стиль» остаются осознанно: нужны всегда
      .filter((t) => !/^Правила (кода|и стиль)$/.test(t));
    expect(
      left,
      `перенос сделан наполовину — правило живёт и в корне, и в docs/rules:\n${left.join('\n')}`,
    ).toEqual([]);
  });

  it('ни один перенесённый файл не усечён', () => {
    const broken: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(RULES_DIR, f), 'utf8');
      const hasTitle = /^# .+/m.test(text);
      // Самая короткая живая секция переноса — около 1,2 тыс. символов;
      // порог намеренно ниже, он ловит усечение, а не краткость
      const hasBody = text.trim().length > 400;
      if (!hasTitle || !hasBody) broken.push(`${f} (${text.trim().length} символов)`);
    }
    expect(broken, `файлы без заголовка или с пустым телом:\n${broken.join('\n')}`).toEqual([]);
  });

  it('указатель ведёт из корневого CLAUDE.md', () => {
    // Указатель, на который ниоткуда не ссылаются, не найдёт никто
    const root = readFileSync(ROOT_CLAUDE, 'utf8');
    expect(root).toContain('docs/rules/INDEX.md');
  });
});

describe('карта подсистем docs/rules/react', () => {
  const index = readFileSync(REACT_INDEX, 'utf8');
  const files = readdirSync(REACT_DIR).filter((f) => f.endsWith('.md') && f !== 'INDEX.md');

  it('каждая ссылка карты ведёт в существующий файл', () => {
    const referenced = [...index.matchAll(/`([a-z0-9-]+\.md)`/g)].map((m) => m[1]);
    const dangling = [...new Set(referenced)].filter((f) => !files.includes(f));
    expect(dangling, `карта обещает файлы, которых нет:\n${dangling.join('\n')}`).toEqual([]);
  });

  it('во вложенном CLAUDE.md не осталось секций «где что лежит»', () => {
    const nested = readFileSync(NESTED_CLAUDE, 'utf8');
    const left = [...nested.matchAll(/^## (Правила [^\n]*)$/gm)]
      // «Ключевые правила» остаются осознанно: нужны всегда
      .map((m) => m[1])
      .filter((t) => !/^Правила$/.test(t));
    expect(
      left,
      `перенос сделан наполовину — секция живёт и во вложенном файле, и в docs/rules/react:\n${left.join('\n')}`,
    ).toEqual([]);
  });

  it('ни один перенесённый файл не усечён', () => {
    const broken: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(REACT_DIR, f), 'utf8');
      if (!/^# .+/m.test(text) || text.trim().length <= 400) {
        broken.push(`${f} (${text.trim().length} символов)`);
      }
    }
    expect(broken, `файлы без заголовка или с пустым телом:\n${broken.join('\n')}`).toEqual([]);
  });

  it('карта ведёт из pinhead-react/CLAUDE.md', () => {
    expect(readFileSync(NESTED_CLAUDE, 'utf8')).toContain('docs/rules/react/INDEX.md');
  });
});
