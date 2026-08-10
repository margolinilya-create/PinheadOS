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
});
