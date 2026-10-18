// Генератор мутаций SQL миграции J (веха 6+7, задача 1).
//
//   node supabase/probes/mutations/make-mutations.mjs <каталог вывода>
//
// Каждая мутация — одна правка тела функции J (строка из помеченного блока `-- J:`
// или хелпера `order_v4_erp_authentic`). Файл `1m-<n>-<имя>-mutation-J.sql`:
//   begin; предусловие (H и I в журнале, md5 тел B/F на бою); J с мутацией;
//   пробы supabase/probes/order_v4_launch.sql; PROBE_RESULT (всё откатывается).
// Ожидание каждого файла — PROBE_RESULT fails>0, проваленная проба названа в `kills`.
// Мутация, помеченная `equivalent`, не меняет поведение на бою (объяснение — в `why`):
// её ожидание fails=0, она в списке, чтобы решение было записано, а не забыто.
// Гоняет файлы контроллер сухими прогонами; итоги — в supabase/probes/README.md.
// Каталог вывода — обязательный аргумент, вне репозитория (файлы не коммитятся).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const J_FILE = join(ROOT, 'supabase/migrations/20261018120000_order_v4_launch.sql');
const PROBE_FILE = join(ROOT, 'supabase/probes/order_v4_launch.sql');

/** Литералы живой базы (SELECT 17–18.10, сверка задачи 0): тела B/F до J */
export const PRE_J_MD5 = {
  'order_v4_transition(uuid, text, text)': '7b4bc1a8f82abb838c08b7161a727074',
  'order_v4_launch_check(uuid)': 'b070898856f442412c65fa543aab0edc',
  'order_v4_set_payment(uuid, text, text)': '3e8b3d32bd3a8f8e2be4f44b1bb32c7d',
  'sales_set_staff(uuid, text, boolean)': 'e63f055a14f0118e17643d570a5a1a5f',
};

/** Перечень мутаций: функция, точная строка тела (ровно одна), замена, какая проба краснеет */
export const MUTATIONS = [
  { name: 'author-role', fn: 'order_v4_transition',
    find: 'v_author := coalesce(public.sales_is_seller() and v_row.created_by = v_uid, false);',
    replace: "v_author := coalesce(v_role = 'manager' and v_row.created_by = v_uid, false);",
    kills: 's_send_ok (продавец с ролью production)' },
  { name: 'no-tz-pdf', fn: 'order_v4_transition',
    find: '    if exists (select 1 from public.order_items i\n',
    replace: '    if false and exists (select 1 from public.order_items i\n',
    kills: 's_send_no_pdf' },
  { name: 'tz-any-folder', fn: 'order_v4_transition',
    find: "not like 'orders/' || v_row.id || '/tz/%'",
    replace: "not like 'orders/%'",
    kills: 's_send_not_tz_dir' },
  { name: 'rights-after-label', fn: 'order_v4_launch_check',
    edits: [
      { find: "  if not (public.erp_is_member() and public.erp_has_permission('order.manage')\n",
        replace: "  if false and not (public.erp_is_member() and public.erp_has_permission('order.manage')\n" },
      { find: "   where id = p_id returning * into v_row;\n  perform set_config('order_v4.rpc', 'off', true);\n\n",
        replace: "   where id = p_id returning * into v_row;\n  perform set_config('order_v4.rpc', 'off', true);\n" +
          "  if not (public.erp_is_member() and public.erp_has_permission('order.manage')\n" +
          "          and public.erp_has_permission('tz.manage')) then\n" +
          "    return jsonb_build_object('ok', false, 'reason', 'Нет прав производства');\n  end if;\n\n" },
    ],
    kills: 'msw_no_label (метка осталась бы у МС без прав)' },
  { name: 'label-no-distinct', fn: 'order_v4_launch_check',
    find: '     and v_row.launch_by is distinct from v_uid then\n    select',
    replace: '     then\n    select',
    kills: 'ms1_renew / ms1_repeat (тот же МС повторно)' },
  { name: 'pay-no-updated-at', fn: 'order_v4_set_payment',
    find: "    'status', v_row.status,\n    'updated_at', v_row.updated_at);",
    replace: "    'status', v_row.status);",
    kills: 's_pay_updated_at / ms1_pay_updated_at' },
  { name: 'ms-pay-null', fn: 'order_v4_set_payment',
    find: '    if p_kind is null or v_reason is not null then',
    replace: '    if v_reason is not null then',
    kills: 'ms1_pay_null' },
  { name: 'self-flag-off', fn: 'sales_set_staff',
    find: '  if p_profile = (select auth.uid()) and not exists (',
    replace: '  if false and p_profile = (select auth.uid()) and not exists (',
    kills: 'rop_self_ms / rop_self_sales' },
  { name: 'authentic-no-owner', fn: 'order_v4_erp_authentic',
    find: '\n               and coalesce(o.owner_id, o.owner::text) = p_launch_by::text',
    replace: '',
    kills: 'fake_check / fake_prod (документы ТЗ из объектов продавца)' },
  { name: 'authentic-empty-order', fn: 'order_v4_erp_authentic',
    find: '     and exists (select 1 from public.erp_order_items i where i.order_id = p_erp)\n',
    replace: '',
    kills: 'fake_empty_check / fake_empty_prod (заказ ERP без позиций)' },
  { name: 'no-erp-link', fn: 'order_v4_transition',
    find: '    if p_erp_order_id is null or p_erp_order_id is distinct from v_erp then',
    replace: '    if false then',
    kills: 'ms1_prod_no_id' },
  { name: 'no-storage-check', fn: 'order_v4_transition',
    find: '                       or not exists (select 1 from storage.objects o\n' +
      "                                       where o.bucket_id = 'order-artworks' and o.name = i.tz_pdf_path",
    replace: '                       or false and not exists (select 1 from storage.objects o\n' +
      "                                       where o.bucket_id = 'order-artworks' and o.name = i.tz_pdf_path",
    kills: 's_send_no_object / s_send_svg_as_pdf / s_send_pdf_8mb' },
  { name: 'no-artwork-check', fn: 'order_v4_transition',
    find: '    if exists (select 1 from public.order_item_prints p\n',
    replace: '    if false and exists (select 1 from public.order_item_prints p\n',
    kills: 's_send_no_artwork / s_send_artwork_no_object' },
  { name: 'no-expected-check', fn: 'order_v4_transition',
    find: '    if p_expected_updated_at is not null and v_row.updated_at is distinct from p_expected_updated_at then',
    replace: '    if false then',
    kills: 's_send_stale / s_send_stale_no_pdf' },
  { name: 'no-return-race', fn: 'order_v4_transition',
    find: "    if v_row.launch_started_at > now() - interval '10 minutes'\n",
    replace: "    if false and v_row.launch_started_at > now() - interval '10 minutes'\n",
    kills: 'ms2_return_race' },
  { name: 'no-is-member', fn: 'order_v4_launch_check',
    find: "  if not (public.erp_is_member() and public.erp_has_permission('order.manage')\n",
    replace: "  if not (public.erp_has_permission('order.manage')\n",
    kills: '—', equivalent: true,
    why: 'erp_has_permission на бою истинна только у активного и одобренного профиля (erp_role_of_caller), ' +
      'а это и есть erp_is_member(): предикат удержан как защита на случай смены определений, ' +
      'проба admin_perm/dir_perm фиксирует значения у admin и director без строки ERP' },
  { name: 'no-duty-own', fn: 'order_v4_launch_check',
    find: '  if v_row.created_by = v_uid and not coalesce(v_boss, false) then',
    replace: '  if false then',
    kills: 'msa_own_check' },
  { name: 'no-duty-override', fn: 'order_v4_launch_check',
    find: '    if v_override_by = v_uid then',
    replace: '    if false then',
    kills: 'rop_override_self_check' },
  { name: 'label-2-minutes', fn: 'order_v4_launch_check',
    find: "  if v_row.launch_started_at > now() - interval '10 minutes'\n",
    replace: "  if v_row.launch_started_at > now() - interval '2 minutes'\n",
    kills: 'ms2_after_3min' },
  { name: 'ms-pay-own', fn: 'order_v4_set_payment',
    find: '    if v_row.created_by is not distinct from v_uid then',
    replace: '    if false then',
    kills: 'msa_own_pay' },
  { name: 'ms-pay-no-perm', fn: 'order_v4_set_payment',
    find: "    if not public.erp_has_permission('order.manage') then",
    replace: '    if false then',
    kills: 'msw_pay' },
  { name: 'rop-ms-off', fn: 'sales_set_staff',
    find: "  if p_kind = 'ms' and p_on is true\n",
    replace: "  if false and p_kind = 'ms' and p_on is true\n",
    kills: 'rop_rop2_ms' },
  // Раунд 2 ревью задачи 1: разделение обязанностей в переходе, метка при смене оплаты,
  // путь документа ТЗ у другого заказа ERP
  { name: 'no-duty-launch-own', fn: 'order_v4_transition',
    find: '    if v_row.created_by = v_uid and not coalesce(v_boss, false) then',
    replace: '    if false then',
    kills: 'race_own_prod (МС-автор зовёт переход напрямую)' },
  { name: 'no-duty-launch-override', fn: 'order_v4_transition',
    find: '      if v_override_by = v_uid then',
    replace: '      if false then',
    kills: 'race_override_prod (rop, разрешивший «без оплаты», зовёт переход напрямую)' },
  { name: 'pay-label-fresh-allowed', fn: 'order_v4_set_payment',
    find: "    if v_row.launch_started_at > now() - interval '10 minutes' then",
    replace: '    if false then',
    kills: 'toctou_pay_fresh / toctou_override_fresh / rop_pay_reason' },
  { name: 'pay-label-kept', fn: 'order_v4_set_payment',
    find: '         launch_started_at = null, launch_by = null,\n',
    replace: '',
    kills: 'toctou_label_cleared / toctou_prod' },
  { name: 'pay-label-erp-allowed', fn: 'order_v4_set_payment',
    find: '    if exists (select 1 from public.erp_orders e\n',
    replace: '    if false and exists (select 1 from public.erp_orders e\n',
    kills: 'toctou_pay_erp' },
  { name: 'authentic-reused-path', fn: 'order_v4_erp_authentic',
    find: '\n               and not exists (\n                 select 1 from public.erp_tz_documents d2\n' +
      '                  where d2.file_path = d.file_path and d2.order_id <> p_erp)',
    replace: '',
    kills: 'oldcopy_check / oldcopy_prod (старая копия ТЗ того же МС у другого заказа ERP)' },
];

/** Границы тела функции `fn` в тексте J: [начало, конец) между `$$` */
export function bodyRange(sql, fn) {
  const m = new RegExp(`create (?:or replace )?function public\\.${fn}\\(`).exec(sql);
  if (!m) throw new Error(`нет функции ${fn} в J`);
  const start = sql.indexOf('$$', m.index) + 2;
  const end = sql.indexOf('$$', start);
  return [start, end];
}

/** J с одной мутацией: каждая правка ищется ровно один раз внутри тела функции */
export function mutate(sql, mutation) {
  const [start, end] = bodyRange(sql, mutation.fn);
  let body = sql.slice(start, end);
  const edits = mutation.edits ?? [{ find: mutation.find, replace: mutation.replace }];
  for (const { find, replace } of edits) {
    const count = body.split(find).length - 1;
    if (count !== 1) throw new Error(`${mutation.name}: строка найдена ${count} раз в ${mutation.fn}`);
    body = body.replace(find, () => replace);
  }
  return sql.slice(0, start) + body + sql.slice(end);
}

/** Предусловие файлов выкатки J: H и I в журнале, тела функций на бою — B/F */
export function preconditionSql() {
  const checks = Object.entries(PRE_J_MD5)
    .map(([sig, md5]) =>
      `  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.${sig}');\n` +
      `  if v is distinct from '${md5}' then\n` +
      `    raise exception 'Функции на бою не совпадают с B/F: ${sig} (md5 %)', v;\n  end if;\n`)
    .join('');
  return `-- ── Предусловие: H и I применены, тела функций на бою — B/F ──
do $pre$
declare v text;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20261017185435')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261018090000') then
    raise exception 'Сначала миграции H и I';
  end if;
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261018120000') then
    raise exception 'Миграция J уже записана в schema_migrations';
  end if;
${checks}end;
$pre$;

`;
}

/** Тело файла проб без шапки, begin и таймаутов (их ставит файл выкатки) */
export function probeBody(text) {
  const m = /^begin;\nset local lock_timeout = '\d+s';\nset local statement_timeout = '\d+s';\n/m.exec(text);
  if (!m) throw new Error('файл проб без begin и таймаутов');
  return text.slice(m.index + m[0].length);
}

function main() {
  const out = process.argv[2];
  if (!out) {
    console.error('Использование: node supabase/probes/mutations/make-mutations.mjs <каталог вне репозитория>');
    process.exit(1);
  }
  mkdirSync(out, { recursive: true });
  const j = readFileSync(J_FILE, 'utf8');
  const probes = probeBody(readFileSync(PROBE_FILE, 'utf8'));
  MUTATIONS.forEach((mu, i) => {
    const n = i + 1;
    const expect = mu.equivalent
      ? `fails=0 — эквивалентная мутация: ${mu.why}`
      : `fails>0, краснеет ${mu.kills}`;
    const text =
      `-- Мутация J №${n} «${mu.name}» (${mu.fn}). СУХОЙ ПРОГОН: всё откатывается.\n` +
      `-- ОЖИДАНИЕ: PROBE_RESULT ${expect}\n` +
      `-- Сгенерировано supabase/probes/mutations/make-mutations.mjs — не править руками.\n\n` +
      "begin;\nset local lock_timeout = '3s';\nset local statement_timeout = '120s';\n\n" +
      preconditionSql() + '-- ── J с мутацией ──\n' + mutate(j, mu) + '\n-- ── Пробы J ──\n' + probes;
    writeFileSync(join(out, `1m-${n}-${mu.name}-mutation-J.sql`), text);
  });
  console.log(`${MUTATIONS.length} файлов мутаций → ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
