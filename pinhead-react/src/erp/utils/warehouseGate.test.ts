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

describe('гейт складской упаковки', () => {
  it('смотрит на фазу подряда', () => {
    expect(DERIVE).toMatch(/sc\.phase not in \('accepted', 'closed'\)/);
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
    expect(DERIVE).toMatch(/t\.task_type = 'fg_receipt'[\s\S]{0,80}t\.status = 'accepted'/);
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
  it('срабатывает только на переходе fg_receipt в accepted', () => {
    expect(FG_ACCEPTED).toMatch(/new\.task_type <> 'fg_receipt' or new\.status <> 'accepted'/);
    // Повторное сохранение уже принятой задачи не должно ничего делать заново
    expect(FG_ACCEPTED).toMatch(/old\.status = 'accepted'/);
  });

  it('повторяет те же предусловия, что и основной триггер', () => {
    expect(FG_ACCEPTED).toMatch(/s\.status not in \('done','skipped'\)/);
    expect(FG_ACCEPTED).toMatch(/sc\.phase not in \('accepted', 'closed'\)/);
  });

  it('создаёт упаковку идемпотентно', () => {
    expect(FG_ACCEPTED).toMatch(/on conflict \(order_id, task_type\) do nothing/);
  });
});
