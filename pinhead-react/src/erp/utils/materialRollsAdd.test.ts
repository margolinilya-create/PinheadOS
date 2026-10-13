// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { functionBody, latestDefining, withoutComments } from './migrations.testutil';

/**
 * ТКАНЬ БЕЗ РУЛОНОВ (правка 01.10, п. 1) — сторож серверной половины.
 *
 * Клиент (`materialTracksRolls`) и сервер (`erp_material_tracks_rolls`)
 * обязаны решать «учитывается ли рулонами» одинаково: строже клиента —
 * «кнопка есть, приёмка падает», мягче — ткань снова уезжает без рулонов.
 */
describe('erp_material_tracks_rolls', () => {
  const body = withoutComments(functionBody(latestDefining('erp_material_tracks_rolls'), 'erp_material_tracks_rolls'));

  it('ткань без единицы считается рулонной, сверх признака единицы', () => {
    expect(body).toMatch(/erp_unit_tracks_rolls\(p_unit\)/);
    expect(body).toMatch(/p_kind\s*=\s*'fabric'/);
    expect(body).toMatch(/coalesce\(btrim\(p_unit\), ''\)\s*=\s*''/);
  });

  it('приёмка требует рулоны по признаку МАТЕРИАЛА, а не одной единицы', () => {
    const accept = withoutComments(functionBody(latestDefining('erp_material_accept'), 'erp_material_accept'));
    expect(accept).toMatch(/erp_material_tracks_rolls\(v_kind, v_unit\)/);
    expect(accept).not.toMatch(/if public\.erp_unit_tracks_rolls\(v_unit\)/);
  });
});

describe('erp_material_rolls_add', () => {
  const sql = latestDefining('erp_material_rolls_add');
  const body = withoutComments(functionBody(sql, 'erp_material_rolls_add'));

  it('definer с гейтом material.receive', () => {
    expect(sql).toMatch(/erp_material_rolls_add[\s\S]*?security definer/);
    expect(body).toMatch(/erp_has_permission\('material\.receive'\)/);
  });

  it('приход не повторяется: журнал приходов не пишется', () => {
    expect(body).not.toMatch(/insert into public\.erp_material_receipts/);
    expect(body).not.toMatch(/update public\.erp_materials/);
  });

  it('сумма весов сверяется с принятым, повтор попытки не заводит рулоны дважды', () => {
    expect(body).toMatch(/v_existing \+ v_sum - v_mat\.qty_received/);
    expect(body).toMatch(/add_key = p_client_key/);
  });

  it('недоступна anon', () => {
    expect(sql).toMatch(/revoke execute on function public\.erp_material_rolls_add\(uuid, jsonb, uuid\) from public, anon/);
  });
});
