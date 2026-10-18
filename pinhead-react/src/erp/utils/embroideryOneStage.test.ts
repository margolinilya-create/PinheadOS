// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  functionBody, latestDefining, migration, migrationFiles, withoutComments,
} from './migrations.testutil';

/**
 * ВЫШИВКА ОДНОЙ ЗАДАЧЕЙ (правки 19.10, п. 1; решения Р1–Р3 плана A).
 *
 * Строка цеха вышивки одна и проходит две фазы: «Разработка программы
 * вышивки» (`result_kind = 'embroidery_program'`) → «Вышивка» (`null`).
 * Фаза есть только у ОДИНОЧНОЙ строки — у старых заказов с парой строк
 * правила прежние (`erp_stage_program_block`).
 *
 * Сторож читает последнюю миграцию, определяющую функцию: проверяется то,
 * что реально будет в базе, а не файл по имени.
 */
const body = (fn: string) => withoutComments(functionBody(latestDefining(fn), fn));
const sqlOf = (fn: string) => withoutComments(latestDefining(fn));

const PREV_BLOCK_FILE = '20260928182342_erp_pravki_27_09_dorabotki.sql';

/** Все `raise …`/`return …` тела — набор веток функции */
function branches(sql: string): Set<string> {
  return new Set(
    [...sql.matchAll(/\b(raise exception[^;]*|return [^;]*);/g)]
      .map((m) => m[1].replace(/\s+/g, ' ').trim()),
  );
}

describe('переход фазы: erp_embroidery_program_finish', () => {
  it('program_finish: definer, файл в storage.objects и заказе, право stage.progress и цех, метка on/off', () => {
    const sql = sqlOf('erp_embroidery_program_finish');
    const fn = body('erp_embroidery_program_finish');
    expect(sql).toMatch(/erp_embroidery_program_finish\(\s*p_stage_id uuid\s*\)\s*returns public\.erp_item_stages[\s\S]*?security definer[\s\S]*?set search_path = public/);
    expect(fn).toMatch(/erp_embroidery_is_phased\(p_stage_id\)/);
    expect(fn).toMatch(/status\s*<>\s*'in_progress'|status is distinct from 'in_progress'/);
    expect(fn).toMatch(/erp_has_permission\('stage\.progress'\)/);
    expect(fn).toMatch(/erp_can_act_in_dept\(v_stage\.department_id\)/);
    // Файл: вложение результата этого этапа и этого заказа И объект в бакете
    expect(fn).toMatch(/from public\.erp_order_attachments a[\s\S]*?a\.kind = 'stage_result'[\s\S]*?a\.stage_id = p_stage_id[\s\S]*?a\.order_id = v_order/);
    expect(fn).toMatch(/from storage\.objects o[\s\S]*?o\.bucket_id = 'erp-attachments'[\s\S]*?o\.name = a\.file_path/);
    // Метка ровно на одно обновление
    const on = fn.indexOf("set_config('erp.program_finish', 'on', true)");
    const upd = fn.indexOf('update public.erp_item_stages');
    const off = fn.indexOf("set_config('erp.program_finish', 'off', true)");
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(upd);
    expect(upd).toBeLessThan(off);
    for (const col of ['result_kind = null', 'operation = null', "status = 'waiting'", 'started_at = null',
      'finished_at = null', 'assignee = null', 'qty_done = 0']) {
      expect(fn, col).toContain(col);
    }
    expect(fn).toContain("'Программа вышивки готова'");
    expect(fn).toContain('Программа уже сдана');
    expect(fn).toMatch(/errcode = '22023'/);
    expect(fn).toMatch(/errcode = '23514'/);
    expect(fn).toMatch(/errcode = '42501'/);
    expect(sql).toMatch(/revoke execute on function public\.erp_embroidery_program_finish\(uuid\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.erp_embroidery_program_finish\(uuid\) to authenticated;/);
  });

  it('без программы: order.manage, причина обязательна, событие с причиной', () => {
    const sql = sqlOf('erp_embroidery_program_skip');
    const fn = body('erp_embroidery_program_skip');
    expect(sql).toMatch(/security definer/);
    expect(fn).toMatch(/erp_has_permission\('order\.manage'\)/);
    expect(fn).toMatch(/v_reason is null[\s\S]*?errcode = '22023'/);
    expect(fn).toMatch(/erp_embroidery_is_phased\(p_stage_id\)/);
    expect(fn).toContain("'Без программы: ' || v_reason");
    expect(fn).not.toMatch(/storage\.objects/);
    expect(sql).toMatch(/grant execute on function public\.erp_embroidery_program_skip\(uuid, text\) to authenticated;/);
  });
});

describe('фаза — только у одиночной строки', () => {
  it('фаза только у одиночной строки: is_phased ищет соседа embroidery с result_kind is null', () => {
    const sql = sqlOf('erp_embroidery_is_phased');
    const fn = body('erp_embroidery_is_phased');
    // Шапка функции — от create до разделителя тела
    const head = /create or replace function public\.erp_embroidery_is_phased\([\s\S]*?\$\$/.exec(sql)![0];
    expect(head).toMatch(/returns boolean[\s\S]*?stable/);
    expect(head).not.toMatch(/security definer/);
    expect(fn).toMatch(/d\.code = 'embroidery'/);
    expect(fn).toMatch(/s\.result_kind = 'embroidery_program'/);
    expect(fn).toMatch(/not exists[\s\S]*?n\.item_id = s\.item_id[\s\S]*?n\.id <> s\.id[\s\S]*?n\.result_kind is null/);
    expect(fn).toMatch(/nd\.code = 'embroidery'/);
    expect(sql).toMatch(/grant execute on function public\.erp_embroidery_is_phased\(uuid\) to authenticated;/);
  });
});

describe('страж запуска вышивки', () => {
  it('route gate ждёт существующие depends_on', () => {
    const sql = sqlOf('erp_item_stages_embroidery_route_gate');
    const fn = body('erp_item_stages_embroidery_route_gate');
    // Имя триггера — `dep_gate`: триггеры одного события идут по алфавиту, и он
    // обязан сработать ДО `erp_item_stages_done_gate` (иначе запрет фазы
    // отвечал бы чужим кодом P0001) и до стража
    expect(sql).toMatch(/create or replace trigger erp_item_stages_dep_gate\s+before update of status, qty_done on public\.erp_item_stages\s+for each row execute function public\.erp_item_stages_embroidery_route_gate\(\)/);
    expect('erp_item_stages_dep_gate' < 'erp_item_stages_done_gate').toBe(true);
    expect(fn).toMatch(/\(select auth\.uid\(\)\) is null/);
    expect(fn).toContain("current_setting('erp.force_complete', true)");
    expect(fn).toContain("current_setting('erp.moving', true)");
    expect(fn).toMatch(/new\.result_kind is null/);
    expect(fn).toMatch(/d\.code = 'embroidery'/);
    expect(fn).toMatch(/p\.id = any\s*\(new\.depends_on\)/);
    expect(fn).toMatch(/not in \(\s*'done',\s*'skipped'\s*\)/);
    expect(fn).toMatch(/coalesce\(new\.qty_done, 0\) > coalesce\(old\.qty_done, 0\)/);
    expect(fn).toContain('Вышивку можно начать после этапа «');
    expect(fn).toMatch(/errcode = '23514'/);
    expect(sql).toMatch(/revoke execute on function public\.erp_item_stages_embroidery_route_gate\(\) from public, anon, authenticated;/);
  });

  it('фаза программы: done и skipped запрещены и под меткой принудительного завершения', () => {
    const fn = body('erp_item_stages_embroidery_route_gate');
    // Запрет фазы стоит ДО пропуска по erp.force_complete
    const phase = fn.indexOf('erp_embroidery_is_phased(old.id)');
    const force = fn.indexOf("current_setting('erp.force_complete', true)");
    expect(phase).toBeGreaterThan(0);
    expect(phase).toBeLessThan(force);
    expect(fn).toMatch(/new\.status in \('done', 'skipped'\)/);
    expect(fn).toContain('Сначала сдайте программу — задача станет «Вышивкой»');
  });

  it('приёмка от подрядчика (erp.subcontract_rollup) не встаёт на фазе: строка становится «Вышивкой»', () => {
    const fn = body('erp_item_stages_embroidery_route_gate');
    // Пропуск метки стоит ДО запрета фазы: иначе 23514 откатил бы всю приёмку
    const rollup = fn.indexOf("current_setting('erp.subcontract_rollup', true)");
    const phase = fn.indexOf('erp_embroidery_is_phased(old.id)');
    expect(rollup).toBeGreaterThan(0);
    expect(rollup).toBeLessThan(phase);
    const branch = fn.slice(rollup, fn.indexOf('end if;', fn.indexOf('return new;', rollup)) + 'end if;'.length);
    expect(branch).toMatch(/new\.result_kind := null;/);
    expect(branch).toMatch(/new\.operation := null;/);
    expect(branch).toMatch(/return new;/);
    // Страж этапов пропускает метку только у подрядной строки — гейт на неё опирается
    const guard = body('erp_stage_guard');
    expect(guard).toMatch(/erp\.subcontract_rollup[\s\S]{0,120}coalesce\(new\.executor, 'internal'\) = 'contractor'/);
    // Триггер гейта идёт раньше стража и прозрачности: новая форма строки видна им
    expect('erp_item_stages_dep_gate' < 'erp_item_stages_guard').toBe(true);
    expect('erp_item_stages_dep_gate' < 'erp_item_stages_passthrough').toBe(true);
  });
});

describe('гейт завершения', () => {
  it('completion_block: одна перегрузка (uuid,int,boolean) и все ветки прежней редакции + ветка фазы', () => {
    const sql = latestDefining('erp_stage_completion_block');
    expect(sql).toContain('drop function if exists public.erp_stage_completion_block(uuid, int);');
    const signatures = [...sql.matchAll(/create or replace function public\.erp_stage_completion_block\(([\s\S]*?)\)\s*returns/g)];
    expect(signatures).toHaveLength(1);
    expect(signatures[0][1]).toMatch(/p_stage_id uuid,\s*p_added_good int default 0,\s*p_final boolean default false/);

    const prev = branches(withoutComments(functionBody(migration(PREV_BLOCK_FILE), 'erp_stage_completion_block')));
    const next = branches(body('erp_stage_completion_block'));
    expect(prev.size).toBeGreaterThan(3);
    for (const b of prev) expect(next.has(b), `пропала ветка: ${b}`).toBe(true);

    const fn = body('erp_stage_completion_block');
    expect(fn).toMatch(/if public\.erp_embroidery_is_phased\(p_stage_id\) then\s+return 'Сначала сдайте программу — задача станет «Вышивкой»/);
    // Ветка фазы — первой и вне p_final: и сдача части результата в фазе запрещена
    expect(fn.indexOf('erp_embroidery_is_phased')).toBeLessThan(fn.indexOf('if p_final then'));
    // Без исключения для принудительного завершения: в гейте меток нет
    expect(fn).not.toContain('erp.force_complete');
  });
});

describe('страж этапов', () => {
  it('guard: смена result_kind вне метки требует order.manage', () => {
    const fn = body('erp_stage_guard');
    expect(fn).toMatch(/new\.result_kind is distinct from old\.result_kind\s+and not public\.erp_has_permission\('order\.manage'\)/);
    expect(fn).toMatch(/raise exception 'erp_stage_guard: тип результата этапа требует права order\.manage'/);
  });

  it('метка перехода фазы пропускает только сам переход', () => {
    const fn = body('erp_stage_guard');
    const at = fn.indexOf("current_setting('erp.program_finish', true)");
    expect(at).toBeGreaterThan(fn.indexOf('if not v_guarded then'));
    expect(at).toBeLessThan(fn.indexOf('v_take     :='));
    const branch = fn.slice(at, fn.indexOf('return new;', at));
    expect(branch).toContain("old.result_kind = 'embroidery_program'");
    expect(branch).toContain('new.result_kind is null');
    expect(branch).toContain("new.status = 'waiting'");
    expect(branch).toContain('coalesce(new.qty_done, 0) = 0');
    expect(branch).toContain("public.erp_has_permission('stage.progress')");
    const allowed = [...branch.matchAll(/to_jsonb\(new\) - array\[([^\]]*)\]/g)];
    expect(allowed).toHaveLength(1);
    const names = [...allowed[0][1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual(['assignee', 'finished_at', 'operation', 'qty_done',
      'result_kind', 'started_at', 'status', 'updated_at']);
  });
});

describe('количество', () => {
  it('passthrough и produced_qty: фаза программы непрозрачна', () => {
    const pass = body('erp_stage_passthrough');
    expect(pass).toMatch(/new\.result_kind is not null\s+and not v_phase/);
    expect(pass).toMatch(/v_phase :=[\s\S]*?new\.result_kind = 'embroidery_program'[\s\S]*?d\.code = 'embroidery'[\s\S]*?not exists[\s\S]*?n\.result_kind is null/);
    const produced = body('erp_item_produced_qty');
    expect(produced).toMatch(/\(s\.result_kind is null or public\.erp_embroidery_is_phased\(s\.id\)\)/);
  });

  it('миграция в журнале — одна, имя из плана', () => {
    expect(migrationFiles()).toContain('20261019100000_erp_embroidery_one_stage.sql');
  });
});
