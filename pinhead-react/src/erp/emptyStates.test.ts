import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withoutJsComments } from './utils/migrations.testutil';

/**
 * «ПУСТО» СОБИРАЕТСЯ ПРИМИТИВОМ, А НЕ СЕРЫМ ТЕКСТОМ В РАМКЕ.
 *
 * Правило проекта (docs/DESIGN.md, волна UX-2): три состояния экрана —
 * ошибка → скелетон → пусто, и «пусто» обязано различать «работы нет
 * по существу» (`EmptyState`) и «под подбор ничего не попало» (`EmptyResult`).
 * Примитивы для этого есть с той же волны, но 12.09 обход нашёл ТРИНАДЦАТЬ
 * мест в восьми файлах, где пустое состояние собрано вручную:
 * `<div className={styles.emptyState}>текст</div>` — без иконки, без
 * заголовка, без кнопки сброса. Рядом, на соседнем экране, стоял полный
 * блок, и разница видна с одного взгляда.
 *
 * Это тот же урок, что с `FilterChip`: примитив, который не приняли, —
 * не примитив. Сторож запрещает новую рукописную копию; исключения
 * перечислены поимённо и с причиной — их два, и оба про носитель,
 * который пустым состоянием ЭКРАНА не является.
 */

const SRC = join(process.cwd(), 'src', 'erp');

/** Файлы, которым носить `styles.emptyState` в разметке законно */
const ALLOWED: Record<string, string> = {
  'src/erp/screens/StyleGuide.jsx': 'витрина показывает сам класс как образец',
};

function jsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsxFiles(p, out);
    else if (/\.jsx$/.test(name) && !/\.test\.jsx$/.test(name)) out.push(p);
  }
  return out;
}

describe('пустые состояния раздела собирают только примитивы', () => {
  const carriers: string[] = [];
  for (const file of jsxFiles(SRC)) {
    const rel = file.replace(process.cwd() + '/', '');
    if (rel in ALLOWED) continue;
    const src = withoutJsComments(readFileSync(file, 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (/styles\.emptyState\b/.test(line)) carriers.push(`${rel}:${i + 1}`);
    });
  }

  it('примитивы состояний приняты экранами — иначе сторож проверяет пустоту', () => {
    // Ноль носителей примитива означал бы, что состояния рисуются как-то ещё,
    // и запрет ниже сторожит не ту величину
    let users = 0;
    for (const file of jsxFiles(SRC)) {
      if (/EmptyState|EmptyResult/.test(readFileSync(file, 'utf8'))) users += 1;
    }
    expect(users).toBeGreaterThan(15);
  });

  it('ни одного рукописного «пусто» в разметке', () => {
    expect(
      carriers,
      `собрано вручную вместо EmptyState/EmptyResult:\n${carriers.join('\n')}`,
    ).toEqual([]);
  });

  it('исключения не протухли: каждый названный файл существует', () => {
    const all = new Set(jsxFiles(SRC).map((f) => f.replace(process.cwd() + '/', '')));
    const stale = Object.keys(ALLOWED).filter((f) => !all.has(f));
    expect(stale, `исключение для несуществующего файла: ${stale.join(', ')}`).toEqual([]);
  });
});
