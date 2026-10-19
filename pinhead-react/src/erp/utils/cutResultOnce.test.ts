// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  functionBody, latestDefining, latestMatching, migration, snapshotExclusions,
  withoutComments, withoutJsComments,
} from './migrations.testutil';

/**
 * ЗАКРОЙ: ВЫПУСК ОДИН РАЗ, РАСХОД ПО РУЛОНАМ (правки 19.10, Р5–Р7, Р11).
 *
 * Миграция C1 (`20261019110000_erp_cut_result_once`): новая форма шлёт годные
 * таблицей `p_sizes`, а рулоны — только расходом. Сервер берёт годные из
 * таблицы, пишет строки выпуска без рулона, блокирует рулон, не верит
 * клиентскому `material_id`; читатели считают средний по материалу; у рулонов
 * появился страж. Сторож читает действующие редакции функций.
 */
const C1 = '20261019110000_erp_cut_result_once.sql';
const PREV = '20261008003410_erp_cut_batch_without_fate.sql';
const ROLLBACK = join(process.cwd(), '../supabase/rollout/r1910a/20261019110000_erp_cut_result_once_rollback.sql');

const submitSql = () => latestDefining('erp_stage_submit_report');
const SUBMIT = () => withoutComments(functionBody(submitSql(), 'erp_stage_submit_report'));

describe('сдача закроя: выпуск один раз (C1)', () => {
  it('действующая редакция submit_report — миграция C1', () => {
    expect(submitSql()).toBe(migration(C1));
  });

  it('годные из p_sizes при рулонах без размеров, report_roll_id null, плюсы после вставки', () => {
    const s = SUBMIT();
    // Старый формат — размеры на рулоне — распознаётся отдельно
    expect(s).toMatch(/v_roll_sized\s*:=\s*v_rolled and exists/);
    // Новая ветка: рулоны есть, размеров на них нет → годные из таблицы выпуска
    expect(s).toMatch(/elsif v_rolled then[\s\S]{0,400}jsonb_to_recordset\(case when v_sized then p_sizes/);
    // Строки выпуска пишутся без рулона, когда размеров на рулонах нет
    const insertAt = s.indexOf('if v_sized and not v_roll_sized then\n    insert into public.erp_stage_report_sizes');
    expect(insertAt).toBeGreaterThan(0);
    // Плюсы — после вставки строк, для любой размерной сдачи закроя (и без рулонов)
    const plusAt = s.indexOf('if v_rolled or (v_sized and coalesce(v_over, false)) then');
    expect(plusAt).toBeGreaterThan(insertAt);
    expect(s.indexOf('set qty_extra = greatest(')).toBeGreaterThan(plusAt);
    // Строки p_sizes проверяются: отрицательных нет
    expect(s).toMatch(/least\(coalesce\(r\.qty_good, 0\), coalesce\(r\.qty_defect, 0\),\s*coalesce\(r\.qty_rework, 0\), coalesce\(r\.qty_extra, 0\)\) < 0/);
    // Потолок «остаток из принятых» — у размерной сдачи без размеров на рулонах
    expect(s).toMatch(/if v_sized and not v_roll_sized then\s+if not coalesce\(v_over, false\) then/);
  });

  it('рулон блокируется for update, дубль roll_id отклоняется, material_id из рулона', () => {
    const s = SUBMIT();
    // Все рулоны сдачи блокируются заранее, в одном порядке (без взаимной блокировки)
    expect(s).toMatch(/from public\.erp_material_rolls r0[\s\S]{0,300}order by r0\.id\s+for update/);
    // И каждый — при чтении в цикле
    expect(s).toMatch(/where r\.id = v_roll_id\s+for update of r/);
    // Повтор рулона в одной сдаче — 22023
    expect(s).toMatch(/having count\(\*\) > 1/);
    expect(submitSql()).toContain('указан в сдаче дважды');
    // Материал строки расхода — из рулона, клиентскому не верим
    expect(s).toMatch(/v_mat_id := v_rollrec\.roll_material/);
    expect(s).not.toMatch(/values\s*\(v_report, v_roll_id,\s*nullif\(v_roll->>'material_id'/);
    // Рулон в килограммах — расход больше нуля
    expect(s).toMatch(/coalesce\(v_used, 0\) <= 0/);
    // Метка сдачи закроя для стража рулонов — включается и выключается
    expect(s).toMatch(/set_config\('erp\.cut_submit', 'on', true\)/);
    expect(s).toMatch(/set_config\('erp\.cut_submit', 'off', true\)/);
  });

  it('фрагменты, на которые смотрят прежние сторожа, на месте', () => {
    const s = SUBMIT();
    expect(s).toMatch(/and public\.erp_stage_program_block\(p_stage_id\) is null\s+and not v_fate_pending\s+then 'done'/);
    expect(s).toMatch(/erp_stage_unaccounted\(p_stage_id, v_good, 0\) <= 0\s+and public\.erp_stage_program_block\(p_stage_id\) is null/);
    expect(s).toMatch(/v_fate_pending := public\.erp_stage_unaccounted\(p_stage_id, v_good, 0\) <= 0\s+and public\.erp_stage_rolls_fate_block\(p_stage_id\) is not null/);
    expect(s).toMatch(/if v_fin and v_kind is null and v_cap is not null/);
    expect(s).toMatch(/erp_stage_size_input\(p_stage_id\)/);
    expect(s).toMatch(/sum\(z\.qty_good \+ z\.qty_defect\)/);
    expect(s).toMatch(/allows_over_plan/);
    expect(s).toMatch(/p_client_key is not null and exists/);
    expect(submitSql()).toContain('шт сдать нельзя — столько осталось из принятых (введено');
    expect(submitSql()).toContain('выберите «Остаток пригоден» или «Малый остаток, не учитывать»');
    // Подпись прежняя, гранты заново
    expect(submitSql()).toMatch(/revoke execute on function public\.erp_stage_submit_report\(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid\) from public, anon;/);
    expect(submitSql()).toMatch(/grant execute on function public\.erp_stage_submit_report\(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid\) to authenticated;/);
  });

  it('без рулонов брак/переделка/плюс из p_qty_*, если строки p_sizes их не несут; швейка — сумма по строкам', () => {
    const s = SUBMIT();
    for (const [key, scalar, target] of [
      ['qty_defect', 'p_qty_defect', 'v_defect'],
      ['qty_rework', 'p_qty_rework', 'v_rework'],
      ['qty_extra', 'p_qty_extra', 'v_extra'],
    ] as const) {
      const re = new RegExp(
        `${target} := case when exists \\(select 1 from jsonb_array_elements\\(p_sizes\\) e\\s+`
        + `where coalesce\\(e->'${key}', 'null'::jsonb\\) <> 'null'::jsonb\\)\\s+`
        + `then \\(select coalesce\\(sum\\(r\\.${key}\\), 0\\)[\\s\\S]{0,160}?\\)\\s+`
        + `else coalesce\\(${scalar}, 0\\) end;`,
      );
      expect(s).toMatch(re);
    }
    // Клиентское зеркало — то же правило: строки задают число, только если рулонов нет и строки его несут
    const client = withoutJsComments(readFileSync(join(process.cwd(), 'src/erp/utils/reportTotals.ts'), 'utf8'));
    expect(client).toMatch(/rolls\.length === 0 && sizes\.some\(\(s\) => s\[key\] != null\)/);
    // Правило — только у сдачи без рулонов: у рулонных веток числа — скаляры
    const rolledBranch = /if v_roll_sized then([\s\S]*?)elsif v_sized then/.exec(s)?.[1] ?? '';
    expect(rolledBranch).toMatch(/v_defect := coalesce\(p_qty_defect, 0\);[\s\S]*v_defect := coalesce\(p_qty_defect, 0\);/);
  });
});

describe('читатели: средний по материалу (Р5, Р6)', () => {
  const usage = () => withoutComments(functionBody(latestDefining('erp_fabric_usage'), 'erp_fabric_usage'));

  it('действующие редакции трёх читателей — C1, пересоздание drop → create в зависимом порядке', () => {
    const sql = migration(C1);
    for (const fn of ['erp_fabric_usage', 'erp_item_economics', 'erp_analytics_fabric_by_sku']) {
      expect(latestDefining(fn)).toBe(sql);
    }
    const dropEco = sql.indexOf('drop function if exists public.erp_item_economics(uuid);');
    const dropSku = sql.indexOf('drop function if exists public.erp_analytics_fabric_by_sku(date, date, uuid, text);');
    const dropUsage = sql.indexOf('drop function if exists public.erp_fabric_usage(uuid);');
    const createUsage = sql.indexOf('create or replace function public.erp_fabric_usage(');
    const createSku = sql.indexOf('create or replace function public.erp_analytics_fabric_by_sku(');
    const createEco = sql.indexOf('create or replace function public.erp_item_economics(');
    expect(Math.min(dropEco, dropSku, dropUsage)).toBeGreaterThan(0);
    expect(dropUsage).toBeGreaterThan(Math.max(dropEco, dropSku));
    expect(createUsage).toBeGreaterThan(dropUsage);
    expect(createSku).toBeGreaterThan(createUsage);
    expect(createEco).toBeGreaterThan(createUsage);
    expect(sql).toMatch(/revoke execute on function public\.erp_fabric_usage\(uuid\) from public, anon;\s*grant execute on function public\.erp_fabric_usage\(uuid\) to authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.erp_item_economics\(uuid\) from public, anon;\s*grant execute on function public\.erp_item_economics\(uuid\) to authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.erp_analytics_fabric_by_sku\(date, date, uuid, text\) from public, anon;\s*grant execute on function public\.erp_analytics_fabric_by_sku\(date, date, uuid, text\) to authenticated, service_role;/);
  });

  it('старый отчёт — roll_good, новый — годные по цвету материала, иначе вся позиция', () => {
    const u = usage();
    // Новый формат: у отчёта нет строк размеров, привязанных к рулону
    expect(u).toMatch(/z0\.report_roll_id is not null/);
    expect(u).toMatch(/z\.report_roll_id is null/);
    // Сравнение цветов — без регистра, пробелов и «ё/е» (зеркало cutUsage.colorKey)
    expect(u).toMatch(/erp_color_key\(z\.color\) = public\.erp_color_key\(b\.mat_color\)/);
    expect(migration(C1)).toMatch(/replace\(lower\(regexp_replace\(coalesce\(p_color, ''\), '\\s\+', '', 'g'\)\), 'ё', 'е'\)/);
    // Годные сдачи относятся на одну строку материала — без задвоения
    expect(u).toMatch(/row_number\(\) over \(partition by b\.rep_id, b\.mat_id order by b\.incomplete, b\.rr_id\)/);
    expect(u).toMatch(/when b\.old_fmt then b\.roll_good_old/);
    expect(u).toMatch(/'color'/);
    expect(u).toMatch(/'item'/);
    // Списание малого остатка этой сдачи входит в средний нового отчёта
    expect(u).toMatch(/a\.kind = 'scrap_writeoff'\s+and a\.report_id = b\.rep_id\s+and a\.roll_id = b\.roll_id/);
  });

  it('экономика: средний Σ(метры + списание) / Σ годных, по материалу', () => {
    const e = withoutComments(functionBody(latestDefining('erp_item_economics'), 'erp_item_economics'));
    expect(e).toMatch(/sum\(u\.metres \+ u\.scrap_m\) filter \(where not u\.incomplete\)\s*\/ sum\(u\.roll_good\) filter \(where not u\.incomplete\)/);
    expect(e).toMatch(/'by_material', v_by_material/);
    expect(e).toMatch(/group by u\.material_id/);
    // Гейт права на месте
    expect(e).toMatch(/erp_has_permission\('economics\.view'\)/);
    const a = withoutComments(functionBody(latestDefining('erp_analytics_fabric_by_sku'), 'erp_analytics_fabric_by_sku'));
    expect(a).toMatch(/sum\(r\.metres \+ r\.scrap_m\) as metres/);
    expect(a).toMatch(/erp_has_permission\('analytics\.view'\)/);
  });
});

describe('страж рулонов (Р11)', () => {
  const guardSql = () => latestDefining('erp_material_roll_guard');
  const GUARD = () => withoutComments(functionBody(guardSql(), 'erp_material_roll_guard'));
  const PROTECTED = ['length_m', 'length_left_m', 'qty', 'qty_left', 'status', 'leftover_kind',
    'price_per_m', 'price_per_unit', 'kg_per_m'];

  it('страж рулонов: исключения снимком, метки roll_adjust и cut_submit, warehouse.manage', () => {
    const g = GUARD();
    const excl = snapshotExclusions(g);
    expect(excl).not.toBeNull();
    for (const col of PROTECTED) expect(excl!.has(col)).toBe(false);
    expect(g).toMatch(/current_setting\('erp\.roll_adjust', true\)/);
    expect(g).toMatch(/current_setting\('erp\.cut_submit', true\)/);
    expect(g).toMatch(/erp_has_permission\('warehouse\.manage'\)/);
    expect(g).toMatch(/auth\.role\(\)\), ''\) = 'service_role'/);
    // Писатели — definer-RPC: внутри них current_user — владелец, у клиента — authenticated
    expect(g).toMatch(/current_user not in \('authenticated', 'anon'\)/);
    expect(g).toMatch(/errcode = '42501'/);
    // Страж — invoker, иначе current_user внутри всегда владелец
    expect(guardSql()).not.toMatch(/function public\.erp_material_roll_guard\(\)[\s\S]{0,120}security definer/);
    expect(latestMatching(/create trigger erp_material_roll_guard/, 'триггер стража рулонов'))
      .toMatch(/before update on public\.erp_material_rolls\s+for each row execute function public\.erp_material_roll_guard\(\)/);
    expect(guardSql()).toMatch(/revoke execute on function public\.erp_material_roll_guard\(\) from public, anon, authenticated;/);
  });

  it('rollback-файл совпадает с прежней редакцией submit_report', () => {
    const rb = readFileSync(ROLLBACK, 'utf8');
    expect(functionBody(rb, 'erp_stage_submit_report')).toBe(functionBody(migration(PREV), 'erp_stage_submit_report'));
    // Только submit_report: читатели и страж остаются новыми
    expect(rb.match(/create or replace function/g)).toHaveLength(1);
    expect(rb).not.toMatch(/drop (?:function|trigger)/);
    expect(rb).toMatch(/grant execute on function public\.erp_stage_submit_report\(uuid, int, int, int, int, int, text, jsonb, jsonb, jsonb, numeric, uuid\) to authenticated;/);
  });
});
