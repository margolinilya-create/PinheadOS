import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';
import { availableActions, subcontractView } from './subcontractFlow';
import { WAREHOUSE_TASK_TYPE_LABELS } from '../types';
import type { ErpItemStage } from '../types';

/**
 * ВЫХОД К ПОДРЯДЧИКУ — ЧЕРЕЗ СКЛАДСКУЮ ПЕРЕДАЧУ (правка заказчика 24.08, п. 3).
 *
 * «Каждый новый выход к подрядчику должен проходить через складскую передачу…
 * Система не должна переводить заказ из нашего цеха напрямую в следующий этап
 * "Подряд"… Заказ не может получить статус "У подрядчика", пока склад
 * не зафиксировал фактическую передачу».
 *
 * ТРЕБОВАНИЕ ИСПОЛНЕНО МЕХАНИКОЙ, А НЕ ЗАПРЕТОМ В КОНСТРУКТОРЕ, и это названо
 * вслух: маршрут «крой → подряд» остаётся законным, потому что между ними
 * теперь стоит задача склада. Запрет ставить подряд после цеха был бы вторым
 * выражением того же правила — и ложным: документ запрещает ПЕРЕВОДИТЬ напрямую,
 * а не проектировать такой маршрут.
 */

const stage = (patch: Partial<ErpItemStage> = {}): ErpItemStage => ({
  id: 'st-sub', item_id: 'i1', department_id: 'd-out', depends_on: ['st-cut'],
  status: 'waiting', qty_done: 0, executor: 'contractor', ...patch,
} as ErpItemStage);

const prev = (patch: Partial<ErpItemStage> = {}): ErpItemStage => ({
  id: 'st-cut', item_id: 'i1', department_id: 'd-cut', depends_on: [],
  status: 'done', qty_done: 100, ...patch,
} as ErpItemStage);

describe('кнопки раздела «Подряд»', () => {
  const view = (sub: Record<string, unknown> | null) => subcontractView(
    sub as never, stage(), [prev(), stage()], 100);

  /**
   * ГЛАВНЫЙ СТОРОЖ ПУНКТА. До правки фазу `at_contractor` ставил менеджер
   * кнопкой «Передать в работу», то есть заказ получал статус «У подрядчика»
   * без единого касания склада — ровно то, что документ запрещает.
   */
  it('у операции ПРИ ЭТАПЕ кнопки запуска нет — передачу фиксирует склад', () => {
    const actions = availableActions(view({ phase: 'planned', stage_id: 'st-sub' }));
    expect(actions.map((a) => a.key)).not.toContain('start');
  });

  /**
   * У легаси-операций без этапа задачи склада не будет НИКОГДА — триггер висит
   * на этапах. Снять у них кнопку значило бы, что такую операцию не запустить
   * вовсе: правило проекта про блок совместимости.
   */
  it('у легаси-операции без этапа кнопка остаётся', () => {
    const actions = availableActions(view({ phase: 'planned', stage_id: null }));
    expect(actions.map((a) => a.key)).toContain('start');
  });

  it('признак берётся из операции, а не из наличия этапа в аргументах', () => {
    // Этап передают всегда; связь хранится у операции, и спутать одно
    // с другим значит снять кнопку у тех, кому она нужна
    expect(view({ phase: 'planned', stage_id: 'st-sub' }).hasStage).toBe(true);
    expect(view({ phase: 'planned' }).hasStage).toBe(false);
    expect(view(null).hasStage).toBe(false);
  });

  it('после передачи доступен возврат — путь не обрывается', () => {
    const actions = availableActions(view({ phase: 'at_contractor', stage_id: 'st-sub' }));
    expect(actions.map((a) => a.key)).toContain('return');
  });
});

describe('тип складской задачи заведён', () => {
  it('«Передача подрядчику» есть среди типов', () => {
    expect(WAREHOUSE_TASK_TYPE_LABELS.subcontract_send).toBe('Передача подрядчику');
  });
});

describe('серверная половина: кто и когда заводит задачу', () => {
  const ENSURE = latestDefining('erp_ensure_subcontract_send');
  const body = withoutComments(functionBody(ENSURE, 'erp_ensure_subcontract_send'));

  it('только подрядный этап', () => {
    // Сравнение с 'contractor', НИКОГДА `<> internal`: у этапов из старых
    // фикстур колонки нет вовсе, и второй вариант отправил бы в подряд всё
    expect(body).toMatch(/executor, 'internal'\) <> 'contractor'/);
  });

  it('только пока этап открыт — у закрытого передавать нечего', () => {
    expect(body).toMatch(/status in \('done', 'skipped'\)/);
  });

  it('ждёт закрытия ВСЕХ предшественников', () => {
    expect(body).toMatch(/p\.id = any \(v_stage\.depends_on\)/);
    expect(body).toMatch(/p\.status not in \('done', 'skipped'\)/);
  });

  /**
   * `where not exists`, а не `on conflict`: индекс уникальности задач при этапе
   * ЧАСТИЧНЫЙ, и голый ON CONFLICT его не выведет — 42P10 при каждом
   * срабатывании. На этом в проекте ловились дважды.
   */
  it('вставка без ON CONFLICT — индекс частичный', () => {
    expect(body).toMatch(/where not exists/);
    expect(body).not.toMatch(/on conflict/i);
  });

  /**
   * Задачу порождает закрытие этапа ЦЕХОМ, а вставка в складские задачи
   * гейтится правами, которых у рабочего нет. С `invoker` цех получал бы 42501
   * на закрытии собственного этапа — правка сломала бы производство.
   */
  it('исполняется от владельца', () => {
    expect(ENSURE).toMatch(/security definer/i);
  });

  it('оба писателя зовут ОДНУ функцию, а не повторяют условие', () => {
    const derive = withoutComments(
      functionBody(latestDefining('erp_warehouse_task_derive'), 'erp_warehouse_task_derive'));
    const onInsert = withoutComments(
      functionBody(latestDefining('erp_subcontract_send_on_insert'), 'erp_subcontract_send_on_insert'));
    expect(derive).toMatch(/erp_ensure_subcontract_send/);
    expect(onInsert).toMatch(/erp_ensure_subcontract_send/);
    // И ни один из них не вставляет задачу передачи сам
    expect(derive).not.toMatch(/'subcontract_send'/);
    expect(onInsert).not.toMatch(/'subcontract_send'/);
  });

  /**
   * Подрядный этап без зависимостей — первый в маршруте, и закрытия
   * предыдущего этапа не случится НИКОГДА. Без этой ветки такой заказ встал бы
   * молча: этап открыт, задачи нет, «У подрядчика» недостижимо.
   */
  it('первый в маршруте подрядный этап получает задачу при вставке', () => {
    const onInsert = withoutComments(
      functionBody(latestDefining('erp_subcontract_send_on_insert'), 'erp_subcontract_send_on_insert'));
    expect(onInsert).toMatch(/array_length\(new\.depends_on, 1\), 0\) = 0/);
  });
});
