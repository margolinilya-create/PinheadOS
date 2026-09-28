// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { functionBody, latestDefining, withoutComments, withoutJsComments } from './migrations.testutil';

/**
 * СУДЬБА ОСТАТКА РУЛОНА — ГЕЙТ И НА СЕРВЕРЕ (правка заказчика 27.09, п. 2).
 *
 * Клиент требовал вид остатка у законченного рулона с 21.09, сервер — нет:
 * три дыры (галочку не ставили; кнопка «Завершить этап» шла мимо формы;
 * RPC вид не проверяла), и на бою 27.09 вид не выбран ни у одного из 60
 * рулонов. Здесь сторожится, что обе серверные половины на месте и что
 * слова отказа совпадают с клиентскими.
 */
describe('судьба остатка рулона на сервере (27.09, п. 2)', () => {
  const SUBMIT = withoutComments(functionBody(latestDefining('erp_stage_submit_report'), 'erp_stage_submit_report'));
  const FATE = withoutComments(functionBody(latestDefining('erp_stage_rolls_fate_block'), 'erp_stage_rolls_fate_block'));

  it('законченный рулон с остатком без вида — отказ RPC', () => {
    expect(SUBMIT).toMatch(/if v_fin and v_kind is null and v_cap is not null/);
    expect(latestDefining('erp_stage_submit_report'))
      .toContain('выберите «Остаток пригоден» или «Малый остаток, не учитывать»');
  });

  it('закрытие этапа спрашивает судьбу рулонов заказа, оставленных «в работе»', () => {
    expect(SUBMIT).toMatch(/erp_stage_unaccounted\(p_stage_id, v_good, 0\) <= 0 then\s+v_block := public\.erp_stage_rolls_fate_block\(p_stage_id\)/);
    expect(FATE).toMatch(/r\.status = 'in_use'/);
    // Остаток — в метрах, а у рулона без метража (принят до 27.09 п. 4) — в кг
    expect(FATE).toMatch(/coalesce\(r\.length_left_m, r\.qty_left, 0\) > 0/);
    expect(FATE).toMatch(/r\.leftover_kind is null/);
    // Только у участка с разбором по рулонам и только когда других открытых
    // этапов участка в заказе нет
    expect(FATE).toMatch(/result_detail = 'rolls'/);
    expect(FATE).toMatch(/not exists \(select 1 from others_open\)/);
  });

  it('сервер и клиент отказывают одними словами', () => {
    const head = 'Не решена судьба остатка: ';
    const tail = ' — отметьте «Остаток пригоден» или «Малый остаток, не учитывать».';
    const sql = latestDefining('erp_stage_rolls_fate_block');
    expect(sql).toContain(head);
    expect(sql).toContain(tail);
    const client = withoutJsComments(readFileSync(join(process.cwd(), 'src/erp/utils/cutRolls.ts'), 'utf8'));
    expect(client).toContain(head);
    expect(client).toContain(tail);
  });
});
