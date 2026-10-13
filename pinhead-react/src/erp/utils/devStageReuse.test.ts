import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, latestMatching, withoutComments } from './migrations.testutil';

/**
 * ЭКС НЕ ЗАДВАИВАЕТ ЭТАПЫ МАРШРУТА (правка 01.09, вторая итерация, п. 2).
 *
 * Дубль рождался из двух независимых механизмов, читающих ОДИН источник —
 * нанесения позиции: `buildRoute` заводил этап цеха при создании заказа,
 * а `erp_experimental_task_send` вставляла второй, подбирая себе свободный
 * `cycle`. Уникальный индекс `(item_id, department_id, cycle)` такой дубль
 * не ловит по построению, поэтому сторожем может быть только текст функции.
 *
 * Проверяется ПОСЛЕДНЕЕ определение: функции пересоздаются целиком, и сторож,
 * читающий раннюю миграцию, сверялся бы с текстом, которого в базе нет.
 */
const SEND = withoutComments(functionBody(
  latestDefining('erp_experimental_task_send'), 'erp_experimental_task_send',
));

describe('erp_experimental_task_send — переиспользование этапа', () => {
  it('ищет ОТКРЫТЫЙ этап того же цеха у позиции', () => {
    expect(SEND).toMatch(/from public\.erp_item_stages/);
    expect(SEND).toMatch(/department_id = p_department_id/);
    expect(SEND).toMatch(/status not in \('done', 'skipped'\)/);
  });

  /**
   * Ветка вставки ОСТАЁТСЯ, и это не остаток: ради повторных заходов образца
   * в один цех (доработка) в проекте и заведён `cycle`. Убери её — второй
   * заход не попал бы в цех вовсе.
   */
  it('свой этап заводит ТОЛЬКО когда открытого нет', () => {
    expect(SEND).toMatch(/if v_stage is null then/);
    expect(SEND).toMatch(/insert into public\.erp_item_stages/);
    expect(SEND).toMatch(/coalesce\(max\(cycle\), -1\) \+ 1/);
  });

  it('статус и счётчики существующего этапа не переписываются', () => {
    // Их ведёт цех; писать их отсюда значило бы завести второго писателя
    const reuse = SEND.slice(SEND.indexOf('elsif p_planned_end is not null'));
    expect(reuse).not.toMatch(/set[\s\S]{0,80}status\s*=/);
    expect(reuse).not.toMatch(/qty_done/);
  });
});

/**
 * Зеркало статуса этапа в задачу разработки больше НЕ зависит от `origin`
 * (правка 01.09, вторая итерация, п. 1).
 *
 * Задача теперь висит на этапе МАРШРУТА (`origin = 'production'`), и со старым
 * условием закрытие цехом до неё не доходило бы — гейт «с Нанесений нельзя
 * дальше» не разблокировался бы никогда. Отбор точен и без `origin`:
 * `where t.stage_id = new.id` находит только привязанные задачи.
 */
describe('триггер erp_experimental_task_sync', () => {
  const SQL = withoutComments(latestMatching(
    /create trigger erp_experimental_task_sync/,
    'триггер erp_experimental_task_sync',
  ));
  const TRIGGER = SQL.slice(SQL.lastIndexOf('create trigger erp_experimental_task_sync'));

  it('срабатывает на смене статуса ЛЮБОГО этапа с привязанной задачей', () => {
    expect(TRIGGER).toMatch(/when \(new\.status is distinct from old\.status\)/);
  });

  it('условия по origin в триггере больше нет', () => {
    expect(TRIGGER).not.toMatch(/origin/);
  });
});
