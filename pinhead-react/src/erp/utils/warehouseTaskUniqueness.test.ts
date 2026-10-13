import { describe, expect, it } from 'vitest';
import { latestMatching, withoutComments } from './migrations.testutil';

/**
 * УНИКАЛЬНОСТЬ СКЛАДСКИХ ЗАДАЧ ЗНАЕТ ПРО ПОЗИЦИОННЫЕ ПРИЁМКИ (правка 14.09, п. 4).
 *
 * Дефект, который сторожится: `erp_warehouse_tasks_order_type_idx` требовал
 * одну задачу каждого вида на заказ, а приёмка материалов с правки 12.09 стала
 * принадлежать ПОЗИЦИИ закупки. Второй материал того же заказа упирался в 23505,
 * и закупка вставала — при том что у позиционных задач есть собственный
 * уникальный индекс по `material_id`.
 *
 * Почему сторож читает ТЕКСТ миграции, а не поведение: индекс — это не функция
 * и не политика, ни один тест приложения его не видит. Ошибка проявляется
 * у закупщика на втором материале, то есть в проде.
 *
 * Читается ПОСЛЕДНЯЯ миграция, создающая индекс: он пересоздавался дважды
 * (20260722120000 — сплошной, 20260820130000 — частичный по stage_id), и тест,
 * привязанный к файлу, сторожил бы файл, а не базу.
 */

const indexSql = () => withoutComments(latestMatching(
  /create unique index if not exists erp_warehouse_tasks_order_type_idx/,
  'erp_warehouse_tasks_order_type_idx',
));

/** Предикат действующего индекса — всё между `where` и концом объявления */
function orderTypePredicate(): string {
  const sql = indexSql();
  const start = sql.indexOf('create unique index if not exists erp_warehouse_tasks_order_type_idx');
  const end = sql.indexOf(';', start);
  const body = sql.slice(start, end);
  const where = body.indexOf('where');
  if (where < 0) throw new Error('у erp_warehouse_tasks_order_type_idx нет предиката');
  return body.slice(where).replace(/\s+/g, ' ').trim();
}

describe('уникальность складских задач', () => {
  it('исключает позиционные приёмки: у заказа с двумя материалами две задачи', () => {
    const predicate = orderTypePredicate();
    expect(predicate).toContain('material_id is null');
  });

  it('по-прежнему держит «одна задача вида на заказ» для задач заказа', () => {
    // stage_id в предикате остаётся: подрядные задачи считаются по этапу
    // (erp_warehouse_tasks_stage_type_idx), и снятие этого условия свело бы
    // два разных правила в одно.
    expect(orderTypePredicate()).toContain('stage_id is null');
  });

  it('у позиционной приёмки есть своя уникальность — по material_id', () => {
    // Иначе «исключили из общего индекса» означало бы «разрешили дубли»:
    // повторный перевод статуса туда-обратно заводил бы вторую задачу
    // на тот же материал.
    const sql = withoutComments(latestMatching(
      /create unique index if not exists erp_warehouse_tasks_material_idx/,
      'erp_warehouse_tasks_material_idx',
    ));
    expect(sql).toMatch(/erp_warehouse_tasks_material_idx[\s\S]*\(material_id\)/);
    expect(sql).toMatch(/where task_type = 'material_receipt'/);
  });

  it('писатель приёмки не полагается на on conflict по (order_id, task_type)', () => {
    // Голый ON CONFLICT по колонкам не выводит частичный индекс — 42P10
    // на каждом срабатывании. Правило проекта записано кровью, и здесь оно
    // особенно важно: предикат индекса только что сузили ещё раз.
    const sql = withoutComments(latestMatching(
      /create or replace function public\.erp_material_receipt_task\(/,
      'erp_material_receipt_task()',
    ));
    expect(sql).not.toMatch(/on conflict\s*\(\s*order_id\s*,\s*task_type\s*\)/i);
    expect(sql).toContain('where not exists');
  });
});
