// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { relative } from 'node:path';
import { SRC_DIR, sourceFiles, readSource } from '../testutil/sourceFiles';

/**
 * Сторож «Моих раскладок» (веха 5в, Э8): таблицу `order_templates` читает и
 * пишет ОДИН модуль — `orderstudio/api/layoutTemplates.ts`. Там строгий разбор
 * данных (`parseLayoutTemplate`: старые шаблоны визарда и битые строки не
 * попадают в список), пределы имени и размера и фильтр «свои». Обращение мимо
 * него — запись без проверки формы или чтение чужого вида шаблонов.
 */
const OWNER = 'orderstudio/api/layoutTemplates.ts';
const MENTION = /(['"`])order_templates\1/;

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

export function tableUsers(files: { name: string; text: string }[]): string[] {
  return files.filter((f) => f.name !== OWNER && !/\.test\.[jt]sx?$/.test(f.name) && MENTION.test(stripComments(f.text))).map((f) => f.name);
}

const files = sourceFiles().map((p) => ({ name: relative(SRC_DIR, p), text: readSource(p) }));

describe('order_templates — только api/layoutTemplates.ts', () => {
  it('вне писателя таблица в коде не названа', () => {
    expect(tableUsers(files)).toEqual([]);
  });

  it('писатель на месте и называет таблицу', () => {
    const owner = files.find((f) => f.name === OWNER);
    expect(owner && MENTION.test(owner.text)).toBe(true);
  });

  it('мутация: обращение из другого модуля — красный', () => {
    const evil = { name: 'orderstudio/design/ui/panel/Evil.jsx', text: "supabase.from('order_templates').insert({ data })" };
    expect(tableUsers([...files, evil])).toEqual([evil.name]);
    expect(tableUsers([{ name: 'x.ts', text: "// from('order_templates')" }])).toEqual([]);
  });
});
