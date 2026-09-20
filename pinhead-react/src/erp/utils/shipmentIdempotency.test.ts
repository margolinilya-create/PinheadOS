import { describe, it, expect } from 'vitest';
import {
  latestMatching, latestDefining, functionBody, withoutComments,
} from './migrations.testutil';

/**
 * ОТГРУЗКА ЗАКАЗА ИЗ НЕСКОЛЬКИХ ПОЗИЦИЙ (правка заказчика 20.09, п. 1).
 *
 * ПОЧЕМУ СТОРОЖ ЧИТАЕТ МИГРАЦИЮ, А НЕ СТОР. Дефект жил в базе: уникальный
 * индекс стоял на одном `client_key`, а RPC пишет строку на КАЖДУЮ позицию
 * с этим же ключом. В тестах стора `erp_ship_order` замокан — мок принимает
 * любые аргументы и не умеет отказать так, как отказывает уникальный индекс.
 * Поэтому все сценарии отгрузки были зелёными, пока склад не смог отгрузить
 * ни один заказ из двух и более позиций.
 *
 * Проверяется ровно то, чего не хватало: ключ строки журнала — ПАРА
 * «попытка + позиция», а повтор отсекает сам INSERT.
 */
describe('идемпотентность отгрузки — ключ попытки и ключ строки (20.09, п. 1)', () => {
  const indexSql = latestMatching(
    /create unique index if not exists erp_order_shipments_client_key_idx/,
    'уникальный индекс журнала отгрузок',
  );

  it('уникальность журнала — по паре client_key + item_id, а не по одному ключу', () => {
    const sql = withoutComments(indexSql);
    const idx = sql.slice(sql.indexOf('create unique index if not exists erp_order_shipments_client_key_idx'));
    const head = idx.slice(0, idx.indexOf(';'));

    expect(head).toMatch(/\(client_key,\s*item_id\)/);
    // Одна попытка = одна строка НА ПОЗИЦИЮ. Уникальность по одному
    // `client_key` означала бы «одна попытка = одна строка на весь заказ»,
    // и вторая позиция падала бы 23505.
    expect(head).not.toMatch(/\(\s*client_key\s*\)/);
    // Частичный: строки без ключа (старый путь из списка заказов) не участвуют
    expect(head).toMatch(/where client_key is not null/);
  });

  it('два неназванных item_id в одной попытке считаются дублем, а не двумя отгрузками', () => {
    // По умолчанию Postgres считает два NULL разными, и строка без позиции
    // прошла бы индекс сколько угодно раз.
    expect(withoutComments(indexSql)).toMatch(/nulls not distinct/);
  });

  const body = functionBody(latestDefining('erp_ship_order'), 'erp_ship_order');

  it('повтор отсекает сам INSERT, а не предварительная проверка', () => {
    const sql = withoutComments(body);
    expect(sql).toMatch(/on conflict \(client_key, item_id\) where client_key is not null/);
    expect(sql).toMatch(/do nothing/);
    // `select exists(...)` перед вставкой — две операции там, где нужна одна:
    // между ними помещаются два параллельных вызова, и второй падает 23505.
    // Тот же дефект уже чинили у приёмки материалов (20260916191916).
    expect(sql).not.toMatch(/select exists\s*\([\s\S]*?erp_order_shipments/);
  });

  it('повтор определяется по фактически записанному, а не по факту вызова', () => {
    const sql = withoutComments(body);
    // Без ROW_COUNT `on conflict do nothing` молчит, и повтор насчитал бы
    // отгруженным то, чего не записал.
    expect(sql).toMatch(/get diagnostics\s+\w+\s*=\s*row_count/i);
  });

  it('событие истории склада пишется только за реально записанное', () => {
    const sql = withoutComments(body);
    const ops = sql.indexOf('erp_warehouse_ops');
    expect(ops).toBeGreaterThan(-1);
    // Условие `v_sent > 0` стоит ДО вставки события: иначе повтор нажатия
    // плодил бы в истории отгрузки, за которыми не стоит ни одного изделия.
    expect(sql.slice(0, ops)).toMatch(/if v_sent > 0 then/);
  });
});
