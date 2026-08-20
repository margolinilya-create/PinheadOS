import { describe, expect, it } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';

/**
 * Гейт упаковки читает ФАЗУ подряда, а не строку статуса.
 *
 * До волны 3.5 условие звучало `sc.status <> 'received_at_pinhead'`. Статус
 * подряда переехал в `phase`, и это сравнение продолжило бы «работать» —
 * всегда истинным, потому что такого значения у живых строк больше нет.
 * Упаковка начала бы создаваться ДО приёмки подряда, и заметили бы это на
 * отгрузке непринятого: ошибка не падает, она просто однажды отгружает не то.
 *
 * Тест сторожит именно этот класс: сравнение со строковым значением, которое
 * молча перестало существовать.
 */

const DERIVE = withoutComments(
  functionBody(latestDefining('erp_warehouse_task_derive'), 'erp_warehouse_task_derive'),
);
const FG_ACCEPTED = withoutComments(
  functionBody(latestDefining('erp_warehouse_fg_accepted'), 'erp_warehouse_fg_accepted'),
);
const CAN_PACK = withoutComments(
  latestDefining('erp_can_pack_ship'),
);

describe('гейт складской упаковки', () => {
  it('смотрит на фазу подряда (через общее условие)', () => {
    expect(CAN_PACK).toMatch(/sc\.phase not in \('accepted', 'closed'\)/);
  });

  it('не сравнивается с уехавшим статусом подряда', () => {
    // Значение переехало в phase='accepted'; сравнение с ним было бы мёртвым
    expect(DERIVE).not.toMatch(/sc\.status/);
    expect(DERIVE).not.toMatch(/received_at_pinhead/);
  });

  it('упаковка по-прежнему ждёт закрытия ВСЕХ этапов заказа', () => {
    expect(DERIVE).toMatch(/s\.status not in \('done','skipped'\)/);
  });

  it('приёмка материалов и маркировка остались на своих триггерах', () => {
    expect(DERIVE).toMatch(/v_code = 'supply' and new\.status = 'done'/);
    expect(DERIVE).toMatch(/v_code = 'sewing' and new\.status = 'in_progress'/);
  });

  /**
   * Третье предусловие упаковки: склад ПРИНЯЛ готовую продукцию. Без него
   * упаковывают то, чего никто не пересчитал, и недостача всплывает у клиента.
   */
  it('требует принятой приёмки готовой продукции', () => {
    expect(CAN_PACK).toMatch(/t\.task_type = 'fg_receipt'[\s\S]{0,80}t\.status = 'accepted'/);
  });
});

/**
 * Закрытие приёмки ГП — СОБЫТИЕ, без которого упаковка не появилась бы никогда.
 *
 * Триггер `erp_warehouse_task_derive` срабатывает на смене статуса ЭТАПА.
 * Но к моменту, когда склад принимает продукцию, все этапы уже закрыты —
 * нового события от них не будет. Поэтому приёмка открывает упаковку сама,
 * своим триггером на складских задачах. Убери его — и заказы будут копиться
 * в «принято на склад» без единой задачи упаковки, и ничего не упадёт.
 */
describe('приёмка ГП открывает упаковку', () => {
  it('срабатывает только на переходе приёмки в accepted', () => {
    expect(FG_ACCEPTED).toMatch(/new\.status <> 'accepted'/);
    // Повторное сохранение уже принятой задачи не должно ничего делать заново
    expect(FG_ACCEPTED).toMatch(/old\.status = 'accepted'/);
    // Обе приёмки: готовой продукции и подряда
    expect(FG_ACCEPTED).toMatch(/'fg_receipt', 'subcontract_receipt'/);
  });

  it('спрашивает те же предусловия, что и основной триггер', () => {
    // Не «повторяет» — именно спрашивает: повтор и был причиной расхождения
    expect(FG_ACCEPTED).toMatch(/erp_can_pack_ship\(/);
    expect(DERIVE).toMatch(/erp_can_pack_ship\(/);
  });

  it('создаёт упаковку идемпотентно — и БЕЗ on conflict', () => {
    /**
     * Идемпотентность держится на проверке существования, а не на
     * `ON CONFLICT`: уникальность задач стала частичной (приёмка подряда
     * уникальна по этапу, остальные — по заказу), а частичный индекс из голого
     * `ON CONFLICT (order_id, task_type)` Postgres не выведет — это 42P10
     * при каждом срабатывании триггера.
     */
    expect(FG_ACCEPTED).not.toMatch(/on conflict/);
    expect(FG_ACCEPTED).toMatch(/where not exists/);
    expect(FG_ACCEPTED).toMatch(/task_type = 'pack_ship'/);
  });
});

/**
 * Предусловия упаковки живут в ОДНОЙ функции.
 *
 * Копий было три — в двух триггерах и в клиенте, — и они разошлись ровно так,
 * как расходятся копии: у заказа С производственными этапами И подрядом
 * «готовое изделие» упаковка не создавалась ВООБЩЕ. Цепочка обрывалась трижды:
 * derive пропускал (подряд не принят), fg_accepted пропускал (подряд всё ещё
 * не принят), а на самом подряде триггера не было. Заказ оставался без задачи
 * упаковки навсегда, и ничего при этом не падало.
 */
describe('предусловия упаковки — одно выражение на всех', () => {
  it('оба триггера спрашивают общую функцию, а не свою копию', () => {
    expect(DERIVE).toMatch(/erp_can_pack_ship\(/);
    expect(FG_ACCEPTED).toMatch(/erp_can_pack_ship\(/);
  });

  it('общая функция проверяет все три условия', () => {
    expect(CAN_PACK).toMatch(/s\.status not in \('done','skipped'\)/);
    expect(CAN_PACK).toMatch(/sc\.phase not in \('accepted', 'closed'\)/);
    expect(CAN_PACK).toMatch(/t\.task_type = 'fg_receipt'[\s\S]{0,80}t\.status = 'accepted'/);
  });

  /**
   * У подряда «под ключ» этапов нет вовсе, приёмке готовой продукции взяться
   * неоткуда, и требование «склад принял ГП» заперло бы такой заказ навсегда.
   */
  it('заказ без производственных этапов не требует приёмки ГП', () => {
    expect(CAN_PACK).toMatch(/or not exists \([\s\S]{0,200}erp_item_stages/);
  });

  it('приёмка подряда закрывает саму подрядную операцию', () => {
    // Раньше это делал клиент и получал 42501 у кладовщика: складскую задачу
    // он двигать вправе, а erp_subcontracting стоит под order.manage
    expect(FG_ACCEPTED).toMatch(/update erp_subcontracting/);
    expect(FG_ACCEPTED).toMatch(/subcontract_receipt/);
  });
});
