import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, latestMatching } from './migrations.testutil';

/**
 * Связь «этап цеха ↔ задача разработки» держится ТРИГГЕРОМ, и это единственный
 * способ, которым она может держаться.
 *
 * ЗАЧЕМ. Цех закрывает этап в своей очереди; карточку разработки он не
 * открывает и открывать не должен. Сегодняшний дефект ровно такой:
 * `completeExperimentalOp` помечает передачу возвращённой, а этап не трогает,
 * и наоборот — связи нет ни в какую сторону. Поэтому этапов, связанных
 * с операциями разработки, в проде НОЛЬ: механизмом не пользовались.
 *
 * ПОЧЕМУ ЭТО НЕ НАРУШАЕТ ПРАВИЛО «маршрут считает клиент». Правило запрещает
 * дублировать на сервере РАСЧЁТ: обход `depends_on`, решение «какие этапы
 * затронуты». Триггер не считает ничего — он зеркалит статус ОДНОЙ строки
 * в ОДНУ строку. Готовность следующих задач по-прежнему считает клиент.
 *
 * Что сторожим здесь — серверную половину. Клиентская («задачу со `stage_id`
 * пишет только триггер») приезжает вместе с экраном: сторож на писателя
 * без писателя проверял бы пустоту.
 */

const SYNC = latestDefining('erp_experimental_task_sync');
const BODY = functionBody(SYNC, 'erp_experimental_task_sync');

describe('зеркало статуса этапа в задачу разработки', () => {
  it('триггер вешается на смену статуса и только на этапы образца', () => {
    // Без отбора по origin функция срабатывала бы на КАЖДОМ переходе
    // любого этапа производства — сотни лишних UPDATE в день
    expect(SYNC).toMatch(/after update of status on public\.erp_item_stages/);
    expect(SYNC).toMatch(/new\.origin = 'experimental'/);
    expect(SYNC).toMatch(/new\.status is distinct from old\.status/);
  });

  it('связь ищется по stage_id, а не по чему-то соседнему', () => {
    expect(BODY).toMatch(/where t\.stage_id = new\.id/);
  });

  it('каждый статус этапа имеет своё отражение', () => {
    // Пропуск ветки не роняет ничего — он оставляет задачу в прежнем статусе,
    // и карточка разработки молча показывает неправду
    for (const status of ['done', 'in_progress', 'blocked', 'skipped']) {
      expect(BODY, `нет ветки для ${status}`).toContain(`'${status}'`);
    }
    // Пропущенный этап — отменённая задача, а не выполненная
    expect(BODY).toMatch(/'skipped'\s+then\s+'cancelled'/);
  });

  it('причина блокировки доезжает до карточки', () => {
    // Иначе технолог видит «заблокировано» без ответа на вопрос «чем»
    expect(BODY).toMatch(/blocked_reason\s*=/);
    expect(BODY).toContain('new.block_reason');
  });

  it('дата закрытия — календарная дата фабрики, а не UTC', () => {
    // База в UTC: с 00:00 до 03:00 по Москве `current_date` — это вчера
    expect(BODY).toContain('erp_local_date()');
    expect(BODY).not.toMatch(/\bcurrent_date\b/);
  });

  it('триггер НЕ пишет в erp_item_stages — рекурсии нет', () => {
    expect(BODY).not.toMatch(/update\s+public\.erp_item_stages/);
  });

  it('функция-триггер не вызывается через REST', () => {
    // Новая функция получает EXECUTE для public по умолчанию; отзыв идёт
    // `from public, anon` — только от anon не работает, право наследуется
    expect(SYNC).toMatch(
      /revoke execute on function public\.erp_experimental_task_sync\(\) from public, anon/,
    );
  });
});

/**
 * Передача задачи в цех — ОДНА транзакция. Прежде клиент делал RPC создания
 * этапа и отдельный UPDATE задачи: при сбое второго этап оставался висеть
 * в очереди цеха, а разработка о нём не знала.
 */
describe('передача задачи в цех', () => {
  const SEND = latestDefining('erp_experimental_task_send');
  const BODY_SEND = functionBody(SEND, 'erp_experimental_task_send');

  it('этап и привязка задачи пишутся в одном вызове', () => {
    expect(BODY_SEND).toMatch(/insert into public\.erp_item_stages/);
    expect(BODY_SEND).toMatch(/update public\.erp_experimental_tasks[\s\S]{0,200}stage_id = v_stage/);
  });

  it('позиция берётся из разработки, а не приходит параметром', () => {
    // Эвристика `items[0]` на экране отправляла бы этап на чужую позицию
    expect(BODY_SEND).toMatch(/select e\.item_id into v_item/);
    expect(SEND).toMatch(/p_task_id uuid,\s*p_department_id uuid/);
  });

  it('без позиции отказывает внятно, а не создаёт этап в никуда', () => {
    expect(BODY_SEND).toMatch(/if v_item is null then[\s\S]{0,200}raise exception/);
  });

  it('цикл считает СЕРВЕР: образец ходит в цех многократно', () => {
    expect(BODY_SEND).toMatch(/coalesce\(max\(cycle\), -1\) \+ 1/);
    expect(BODY_SEND).toMatch(/'experimental'/);
  });

  it('SECURITY INVOKER — «одним запросом» не значит «мимо RLS»', () => {
    expect(SEND).toMatch(/security invoker/);
  });
});

/**
 * Пачка задач: зависимости внутри пачки задаются ИНДЕКСАМИ элементов массива —
 * тем же приёмом, что этапы в `erp_create_order`. Иначе клиенту пришлось бы
 * вставлять задачи по одной и связывать вторым запросом.
 */
describe('пачка задач разработки', () => {
  const ADD = latestDefining('erp_experimental_add_tasks');
  const BODY_ADD = functionBody(ADD, 'erp_experimental_add_tasks');

  it('два прохода: сначала строки, потом связи по индексам', () => {
    // Один проход запретил бы любой порядок, кроме топологического
    expect(BODY_ADD).toMatch(/v_ids := v_ids \|\| v_new_id/);
    expect(BODY_ADD).toMatch(/depends_on = v_deps/);
  });

  it('индекс вне массива пропускается, а не даёт осиротевшую зависимость', () => {
    // Ссылка в никуда держала бы задачу закрытой навсегда
    expect(BODY_ADD).toMatch(/between 1 and array_length\(v_ids, 1\)/);
  });

  it('номер круга считается по ТИПУ задачи', () => {
    // Вторая примерка — cycle 1, а первая задача другого типа остаётся на нуле
    expect(BODY_ADD).toMatch(
      /coalesce\(max\(cycle\), -1\) \+ 1[\s\S]{0,200}task_type = \(v_task->>'task_type'\)/,
    );
  });

  it('не массив — внятный отказ', () => {
    expect(BODY_ADD).toMatch(/jsonb_typeof\(p_tasks\) <> 'array'[\s\S]{0,200}raise exception/);
  });
});

/**
 * Права на задачи — то же право, что у самой разработки. Разъехавшиеся
 * половины дали бы «карточка открыта, задача не сохраняется».
 */
describe('права на задачи разработки', () => {
  const RLS = latestMatching(
    /create policy erp_experimental_tasks_insert/,
    'политики задач разработки',
  );

  it('запись — под experimental.manage, чтение — участнику раздела', () => {
    for (const cmd of ['insert', 'update']) {
      expect(RLS).toMatch(
        new RegExp(`create policy erp_experimental_tasks_${cmd}[\\s\\S]{0,300}erp_has_permission\\('experimental\\.manage'\\)`),
      );
    }
    expect(RLS).toMatch(
      /create policy erp_experimental_tasks_read[\s\S]{0,200}erp_is_member\(\)/,
    );
  });

  it('политика пишется НА КОМАНДУ, а не `for all`', () => {
    // Иначе Postgres проверяет обе на каждый SELECT (advisor multiple_permissive_policies)
    expect(RLS).not.toMatch(/create policy erp_experimental_tasks_\w+ on [\w.]+\s+for all/);
  });
});
