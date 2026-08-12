import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { latestMatching } from './migrations.testutil';
import { DICTIONARY_HINTS, DICTIONARY_LABELS } from '../types';
import type { DictionaryKind } from '../types';

/**
 * Вид справочника обязан существовать во ВСЕХ четырёх местах сразу.
 *
 * ЧТО НАШЛОСЬ. `unit` был заведён миграцией 20260810200000 вместе с CHECK,
 * подписью «Единицы измерения» и подсказкой «кг, м, шт» — то есть выглядел
 * сделанным. Но в `KINDS` (`screens/admin/DictionariesTab.jsx`) его не вписали,
 * и справочник единиц не редактировался из админки ВООБЩЕ: пять значений
 * лежали в базе, подсказки в поле работали, а дополнить или отключить их
 * было нельзя ниоткуда.
 *
 * Это ровно тот жанр, который проект уже описал про терминальные статусы
 * складских задач: «двенадцать точек касания, и пропуск не роняет ничего —
 * он даёт молчаливо неработающую половину».
 *
 * Мест четыре, и каждое отвечает за своё:
 *  · CHECK в базе — иначе `insert` падает на 23514;
 *  · `DictionaryKind` — иначе значение не типизировано;
 *  · подпись и подсказка — иначе в админке пустой заголовок;
 *  · `KINDS` — иначе вкладки справочника просто нет.
 */

const SRC = join(process.cwd(), 'src');

/** Виды из ДЕЙСТВУЮЩЕГО CHECK — последняя миграция, которая его пересоздаёт */
function kindsInCheck(): string[] {
  const sql = latestMatching(
    /add constraint erp_dictionaries_kind_check/,
    'CHECK видов справочника',
  );
  const block = sql.match(
    /add constraint erp_dictionaries_kind_check\s+check \(kind in \(([\s\S]*?)\)\)/,
  )?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/** Виды, доступные админу (массив `KINDS` в файле вкладки) */
function kindsInAdmin(): string[] {
  const src = readFileSync(join(SRC, 'erp/screens/admin/DictionariesTab.jsx'), 'utf8');
  const block = src.match(/const KINDS = \[([\s\S]*?)\];/)?.[1] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe('виды справочников сходятся во всех четырёх местах', () => {
  const IN_CHECK = kindsInCheck();
  const IN_ADMIN = kindsInAdmin();
  const IN_TYPES = (Object.keys(DICTIONARY_LABELS) as DictionaryKind[]).sort();

  it('обе стороны найдены — сторож не сторожит пустоту', () => {
    expect(IN_CHECK.length).toBeGreaterThanOrEqual(5);
    expect(IN_ADMIN.length).toBeGreaterThanOrEqual(5);
  });

  it('CHECK базы и тип клиента перечисляют одно и то же', () => {
    expect(IN_TYPES).toEqual(IN_CHECK);
  });

  it('каждый вид редактируется из админки', () => {
    // Пропуск здесь ничего не роняет — он даёт справочник, которого нет
    const missing = IN_TYPES.filter((k) => !IN_ADMIN.includes(k));
    expect(missing, `нет вкладки в админке: ${missing.join(', ')}`).toEqual([]);
  });

  it('в админке нет вида, которого не примет база', () => {
    // Обратная сторона: вкладка есть, а `insert` падает на 23514
    const extra = IN_ADMIN.filter((k) => !IN_CHECK.includes(k));
    expect(extra, `вида нет в CHECK: ${extra.join(', ')}`).toEqual([]);
  });

  it('у каждого вида есть подпись и подсказка на русском', () => {
    for (const kind of IN_TYPES) {
      expect(DICTIONARY_LABELS[kind], `нет подписи у ${kind}`).toMatch(/[а-яА-Я]/);
      expect(DICTIONARY_HINTS[kind], `нет подсказки у ${kind}`).toMatch(/[а-яА-Я]/);
    }
  });

  it('единицы измерения вернулись в админку — та самая находка', () => {
    expect(IN_ADMIN).toContain('unit');
  });

  it('типы задач разработки заведены', () => {
    expect(IN_CHECK).toContain('experimental_task_type');
    expect(IN_ADMIN).toContain('experimental_task_type');
  });
});
