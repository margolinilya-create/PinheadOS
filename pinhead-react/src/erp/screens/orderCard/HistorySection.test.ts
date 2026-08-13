import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * История заказа не должна показывать сырые коды базы (M-07 отчёта QA
 * 13.08.2026): в ленте попадалось `accepted_full` вместо «принято полностью».
 *
 * Перевод значений раньше был цепочкой `if` на шесть полей из тридцати с лишним.
 * Пропуск в такой цепочке ничего не ломает — она печатает то, что пришло
 * из базы, и выглядит это как техническая протечка, а не как ошибка.
 *
 * Тест читает исходник: обе таблицы — обычные объектные литералы, и другого
 * способа сверить их состав нет.
 */

const RAW = readFileSync(
  join(process.cwd(), 'src/erp/screens/orderCard/HistorySection.jsx'),
  'utf8',
);
// Комментарии снимаем: между записями литерала их несколько строк подряд,
// и ключ после них не читался как ключ
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Ключи объектного литерала `const NAME = { … }` — включая 'в кавычках' */
function keysOf(constName: string): string[] {
  const start = SRC.indexOf(`const ${constName} = {`);
  if (start < 0) throw new Error(`нет ${constName}`);
  const body = SRC.slice(start, SRC.indexOf('};', start));
  return [...body.matchAll(/[{,]\s*'?([\w.]+)'?:/g)].map((m) => m[1]);
}

/**
 * Поля со СТАТУСОМ или перечислением в значении: их нельзя показывать как есть.
 * Название, комментарий, имя исполнителя и числа переводить не нужно —
 * они уже человеческие.
 */
const CODED = [
  'status',
  'shipped_status',
  'packaging',
  'stickers',
  'stage.status',
  'material.status',
  'material.accept_status',
  'material.kind',
  'procurement.status',
  'subcontract.status',
];

describe('история заказа переводит коды в слова', () => {
  it('у каждого поля-перечисления есть словарь значений', () => {
    const values = new Set(keysOf('AUDIT_VALUE_LABELS'));
    const missing = CODED.filter((f) => !values.has(f));
    expect(missing, `сырые коды попадут в ленту: ${missing.join(', ')}`).toEqual([]);
  });

  it('поле со словарём значений обязано иметь и подпись', () => {
    // Иначе строка читается как «material.accept_status: принято полностью» —
    // половина переведена, половина нет.
    const labels = new Set(keysOf('AUDIT_FIELD_LABELS'));
    const missing = keysOf('AUDIT_VALUE_LABELS').filter((f) => !labels.has(f));
    expect(missing, `нет подписи поля: ${missing.join(', ')}`).toEqual([]);
  });

  it('перевод значений идёт таблицей, а не цепочкой if', () => {
    // Цепочка и была причиной: в неё легко не дописать поле, и это не видно.
    expect(SRC).toContain('const AUDIT_VALUE_LABELS = {');
    expect(SRC).toContain('const labels = AUDIT_VALUE_LABELS[field];');
  });
});
