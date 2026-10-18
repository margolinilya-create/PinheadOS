// Файлы выкатки миграций вехи 8 — L (20261018150000), K (20261018160000), M (20261018170000).
//
//   node supabase/rollout/m8/build.mjs                    — пересобрать файлы этой папки
//   node supabase/rollout/m8/build.mjs --mutations <dir>  — ещё и мутации SQL в <dir> (вне репозитория)
//
// Файлы собираются из миграций, проб и снимка — руками не правятся (сторож
// pinhead-react/src/orderstudio/orderV4M8.test.ts сверяет папку со сборкой).
// Кто применяет — в шапке каждого файла и в README.md этой папки:
//   · КОНТРОЛЛЕР (обёртка MCP `execute_sql`): 1-dryrun-*, 2-apply-*, 3-rollback-*,
//     4-dryrun-rollback-* для L и K — в них нет слов, на которых MCP ждёт подтверждения;
//   · ВЛАДЕЛЕЦ (SQL Editor): 1b-*-regress (пробы прав с удалением строк), 3b-drop-zone-id,
//     все файлы M, мутации.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..', '..');
const MIG = join(ROOT, 'supabase/migrations');
const PROBES = join(ROOT, 'supabase/probes');

export const VERSIONS = {
  J: '20261018120000', G: '20261017150000',
  L: '20261018150000', K: '20261018160000', M: '20261018170000',
};
export const NAMES = {
  L: 'order_v3_readonly_staff_audit', K: 'order_v4_zone_notes', M: 'catalog_legacy_keys',
};
/** Литералы живой базы после J (задача 0, SELECT 18.10; = supabase/probes/README.md «Веха 8») */
export const T0_MD5 = {
  'order_v4_guard()': '8dab43ebfb6d773f9c223844abb494fd',
  'order_v4_delete_guard()': '328e9df158071c55cbec4e655686d9b7',
  'order_v4_child_guard()': '75051f6f7d964b8be7b8888e0bb826ff',
  'order_v4_save(jsonb)': '06a632efc09bf431c0c3c861960c22d9',
  'order_v4_save_full(jsonb)': '6be40fb03b7eec70b76bf5de08b57c83',
};
/** Файлы, которые применяет контроллер через MCP: слов `drop`/`delete` в исполняемом тексте нет */
export const CONTROLLER_FILES = [
  '1-dryrun-L.sql', '2-apply-L.sql', '3-rollback-L.sql', '4-dryrun-rollback-L.sql',
  '4b-dryrun-rollback-L-after-apply.sql',
  '1-dryrun-K.sql', '2-apply-K.sql', '3-rollback-K-functions.sql', '4-dryrun-rollback-K.sql',
];

export const md5 = (s) => createHash('md5').update(s).digest('hex');
const read = (p) => readFileSync(p, 'utf8');
export const migrationText = (k) => read(join(MIG, `${VERSIONS[k]}_${NAMES[k]}.sql`));

/** Оператор `create or replace function public.<fn>(` … `$$;` и тело между `$$` */
export function fnStatement(sql, fn) {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  if (start < 0) throw new Error(`нет функции ${fn}`);
  const b = sql.indexOf('$$', start);
  const e = sql.indexOf('$$;', b + 2);
  return { text: sql.slice(start, e + 3), body: sql.slice(b + 2, e) };
}

/**
 * Обратная замена блоков `-- <P>:begin <метка>` … `-- <P>:was|<строка>` … `-- <P>:end <метка>`.
 * `keep(tag)` — блоки, которые остаются как есть (откат L оставляет `notes-*`).
 */
export function revertBlocks(text, prefix, keep = () => false) {
  const out = [];
  let tag = null;
  let was = [];
  let kept = [];
  const reBegin = new RegExp(`^\\s*-- ${prefix}:begin (\\S+)$`);
  const reEnd = new RegExp(`^\\s*-- ${prefix}:end (\\S+)$`);
  const reWas = new RegExp(`^\\s*-- ${prefix}:was\\|(.*)$`);
  for (const line of text.split('\n')) {
    const b = line.match(reBegin);
    const e = line.match(reEnd);
    const w = line.match(reWas);
    if (b) {
      if (tag) throw new Error(`блок ${b[1]} внутри ${tag}`);
      tag = b[1]; was = []; kept = [line];
    } else if (e) {
      if (e[1] !== tag) throw new Error(`конец ${e[1]} без начала`);
      if (keep(tag)) out.push(...kept, line); else out.push(...was);
      tag = null;
    } else if (w) {
      if (!tag) throw new Error('строка was вне блока');
      was.push(w[1]); kept.push(line);
    } else if (tag) {
      if (new RegExp(`-- ${prefix}:`).test(line)) throw new Error(`неизвестная метка: ${line}`);
      kept.push(line);
    } else {
      out.push(line);
    }
  }
  if (tag) throw new Error(`блок ${tag} не закрыт`);
  return out.join('\n');
}

/** Тело файла проб без шапки, begin и таймаутов (их ставит файл выкатки) */
export function probeBody(text) {
  const m = /^begin;\nset local lock_timeout = '\d+s';\nset local statement_timeout = '\d+s';\n/m.exec(text);
  if (!m) throw new Error('файл проб без begin и таймаутов');
  return text.slice(m.index + m[0].length);
}

const HEAD = "begin;\nset local lock_timeout = '3s';\nset local statement_timeout = '120s';\n\n";
const journalHas = (v) => `exists (select 1 from supabase_migrations.schema_migrations where version = '${v}')`;
const md5Check = (sig, h, msg) =>
  `  select md5(prosrc) into v from pg_proc where oid = to_regprocedure('public.${sig}');\n` +
  `  if v is distinct from '${h}' then\n    raise exception '${msg}: ${sig} (md5 %)', v;\n  end if;\n`;
const doBlock = (tag, title, lines) =>
  `-- ── ${title} ──\ndo $${tag}$\ndeclare v text;\nbegin\n${lines}end;\n$${tag}$;\n\n`;

/** Все тексты сборки: md5 тел, тела откатов, файлы папки */
export function build() {
  const L = migrationText('L');
  const K = migrationText('K');
  const M = migrationText('M');
  const B = read(join(MIG, '20261017062110_order_v4_rights.sql'));
  const D = read(join(MIG, '20261017101513_order_v4_client_rev.sql'));

  const lGuard = fnStatement(L, 'order_v4_guard');
  const lDel = fnStatement(L, 'order_v4_delete_guard');
  const kFull = fnStatement(K, 'order_v4_save_full');
  const bDel = fnStatement(B, 'order_v4_delete_guard');
  const dFull = fnStatement(D, 'order_v4_save_full');
  // Откат L: тело стража B + классификация notes (годится и до, и после K)
  const rbGuardText = revertBlocks(lGuard.text, 'L', (t) => t.startsWith('notes-'));
  const rbGuard = fnStatement(rbGuardText, 'order_v4_guard');

  const MD5 = {
    L: { 'order_v4_guard()': md5(lGuard.body), 'order_v4_delete_guard()': md5(lDel.body) },
    K: { 'order_v4_save_full(jsonb)': md5(kFull.body) },
    rollbackL: { 'order_v4_guard()': md5(rbGuard.body), 'order_v4_delete_guard()': md5(bDel.body) },
    rollbackK: { 'order_v4_save_full(jsonb)': md5(dFull.body) },
  };

  // ── предусловия ──
  const preL = doBlock('pre', 'Предусловие: J применена, L нет, стражи на бою — тела B (литералы задачи 0)',
    `  if not ${journalHas(VERSIONS.J)} then\n    raise exception 'Сначала миграция J (${VERSIONS.J})';\n  end if;\n` +
    `  if ${journalHas(VERSIONS.L)} then\n    raise exception 'Миграция L уже записана в schema_migrations';\n  end if;\n` +
    md5Check('order_v4_guard()', T0_MD5['order_v4_guard()'], 'Функции на бою не совпадают с B') +
    md5Check('order_v4_delete_guard()', T0_MD5['order_v4_delete_guard()'], 'Функции на бою не совпадают с B'));
  const afterL = doBlock('pre', 'Предусловие отката: L применена, стражи — тела L',
    `  if not ${journalHas(VERSIONS.L)} then\n    raise exception 'L в журнале нет — откатывать нечего';\n  end if;\n` +
    Object.entries(MD5.L).map(([s, h]) => md5Check(s, h, 'Страж на бою не равен L — откат сверить вручную')).join(''));
  const preK = doBlock('pre', 'Предусловие: L применена, K нет; функции — тела D/B, стражи — тела L',
    `  if not ${journalHas(VERSIONS.L)} then\n    raise exception 'Сначала миграция L (${VERSIONS.L})';\n  end if;\n` +
    `  if ${journalHas(VERSIONS.K)} then\n    raise exception 'Миграция K уже записана в schema_migrations';\n  end if;\n` +
    ['order_v4_save(jsonb)', 'order_v4_save_full(jsonb)', 'order_v4_child_guard()']
      .map((s) => md5Check(s, T0_MD5[s], 'Функции на бою не совпадают с D/B')).join('') +
    Object.entries(MD5.L).map(([s, h]) => md5Check(s, h, 'Страж на бою не равен L')).join(''));
  const afterK = doBlock('pre', 'Предусловие отката: K применена, обёртка — тело K',
    `  if not ${journalHas(VERSIONS.K)} then\n    raise exception 'K в журнале нет — откатывать нечего';\n  end if;\n` +
    md5Check('order_v4_save_full(jsonb)', MD5.K['order_v4_save_full(jsonb)'], 'Обёртка на бою не равна K — откат сверить вручную'));
  const preM = doBlock('pre', 'Предусловие: G применена, M нет (значения сверяет сама миграция по снимку)',
    `  if not ${journalHas(VERSIONS.G)} then\n    raise exception 'Сначала миграция G (${VERSIONS.G})';\n  end if;\n` +
    `  if ${journalHas(VERSIONS.M)} then\n    raise exception 'Миграция M уже записана в schema_migrations';\n  end if;\n`);
  const afterM = doBlock('pre', 'Предусловие отката: M применена',
    `  if not ${journalHas(VERSIONS.M)} then\n    raise exception 'M в журнале нет — откатывать нечего';\n  end if;\n`);
  const checkMd5 = (title, map, msg) => doBlock('chk', title,
    Object.entries(map).map(([s, h]) => md5Check(s, h, msg)).join(''));

  // ── тексты откатов ──
  const rollbackL =
    '-- ── Откат L: стражи — тела B, но `notes` остаётся полем черновика ──\n' +
    '-- (K пишет notes через order_v4_save_full: тело B без notes дало бы 42501 на каждом\n' +
    '-- сохранении с комментарием). CHECK orders_notes_len остаётся (безвреден). Таблица журнала\n' +
    '-- остаётся без грантов, триггер выключен; гранты order_comments не возвращаются.\n' +
    rbGuard.text + '\n\nrevoke execute on function public.order_v4_guard() from public, anon, authenticated;\n\n' +
    bDel.text + '\n\nrevoke execute on function public.order_v4_delete_guard() from public, anon, authenticated;\n\n' +
    'revoke all on public.sales_staff_events from public, anon, authenticated;\n' +
    'alter table public.profiles disable trigger profiles_sales_staff_audit;\n\n' +
    "notify pgrst, 'reload schema';\n\n";
  const rollbackK =
    '-- ── Откат функций K: обёртка — тело D (порог ревизии 3); колонка zone_id остаётся ──\n' +
    dFull.text + '\n\nrevoke execute on function public.order_v4_save_full(jsonb) from public, anon;\n' +
    'grant execute on function public.order_v4_save_full(jsonb) to authenticated;\n\n' +
    "notify pgrst, 'reload schema';\n\n";
  const snap = JSON.parse(read(join(ROOT, 'supabase/snapshots/catalog_config_legacy_2026-10-18.json')));
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const rollbackM =
    '-- ── Откат M: значения снимка задачи 0 и прежнее условие политики чтения G ──\n' +
    snap.rows.map((r) =>
      `insert into public.catalog_config (key, value, updated_at)\nvalues (${q(r.key)}, ${q(JSON.stringify(r.value))}::jsonb, ${q(r.updated_at)});\n`).join('') +
    '\nalter policy catalog_config_select on public.catalog_config\n' +
    "  using ((select public.catalog_reader())\n         and (key <> 'prices' or (select public.sales_is_lead())));\n\n" +
    "notify pgrst, 'reload schema';\n\n";
  const checkM = doBlock('chk', 'Сверка отката M: значения равны снимку по md5',
    snap.rows.map((r) =>
      `  select md5(value::text) into v from public.catalog_config where key = '${r.key}';\n` +
      `  if v is distinct from '${r.md5}' then\n    raise exception 'ОТКАТ M: ${r.key} не равен снимку (md5 %)', v;\n  end if;\n`).join(''));

  const probes = (f) => probeBody(read(join(PROBES, f)));
  const total = (f) => /fails=0 total=(\d+)/.exec(read(join(PROBES, f)))[1];
  const journal = (k) =>
    `insert into supabase_migrations.schema_migrations (version, name) values ('${VERSIONS[k]}', '${NAMES[k]}');\n\ncommit;\n\n`;

  // Пробы после отката L (без слов удаления): v3 снова пишется клиентом, notes — поле
  // черновика, CHECK длины на месте, журнал признаков не пишется и закрыт
  const afterRollbackLProbes = read(join(HERE, 'probes-after-rollback-L.sql'));
  const afterRollbackKProbes = read(join(HERE, 'probes-after-rollback-K.sql'));

  const files = {
    '1-dryrun-L.sql':
      `-- СУХОЙ ПРОГОН миграции L (${VERSIONS.L}) + пробы supabase/probes/order_v3_readonly.sql.\n` +
      '-- КОНТРОЛЛЕР (обёртка MCP) или SQL Editor. ДО выкладки фронта вехи 8.\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total('order_v3_readonly.sql')} {…}. 'Сначала миграция J' /\n` +
      "-- 'Функции на бою не совпадают с B' — L НЕ применять, разобраться. Всё откатывается.\n\n" +
      HEAD + preL + '-- ── Миграция L ──\n' + L + '\n-- ── Пробы L ──\n' + probes('order_v3_readonly.sql'),
    '1b-dryrun-L-regress.sql':
      `-- СУХОЙ ПРОГОН миграции L + регресс прав: supabase/probes/order_v4_rights.sql (редакция вехи 8).\n` +
      '-- ВЛАДЕЛЕЦ в SQL Editor: в пробах прав есть удаление строк (удаление v3 руководством — 42501,\n' +
      '-- удаление v4-родителя обнуляет parent_id строки v3) — MCP на нём ждёт подтверждения.\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total('order_v4_rights.sql')} {…}\n\n` +
      HEAD + preL + '-- ── Миграция L ──\n' + L + '\n-- ── Пробы прав (редакция вехи 8) ──\n' + probes('order_v4_rights.sql'),
    '2-apply-L.sql':
      '-- ПРИМЕНЕНИЕ миграции L — после зелёных 1-dryrun-L, 1b-dryrun-L-regress (владелец),\n' +
      '-- 4-dryrun-rollback-L и мутаций L (каждая fails>0). ДО выкладки фронта вехи 8. КОНТРОЛЛЕР.\n' +
      `-- Ожидание: последний select — 't | ${VERSIONS.L}'. Затем: пробы order_v3_readonly.sql на бою (fails=0),\n` +
      '-- APPLIED.json, npm run migrations:verify, 4b-dryrun-rollback-L-after-apply.sql (fails=0).\n' +
      '-- Откат — 3-rollback-L.sql (в любой момент: клиент вехи 8 v3 не пишет).\n\n' +
      HEAD + preL + '-- ── Миграция L ──\n' + L + '\n' +
      checkMd5('Сверка: стражи на бою = тексту L', MD5.L, 'APPLY: страж не равен тексту L') + journal('L') +
      "select to_regclass('public.sales_staff_events') is not null as l_on,\n" +
      '       (select max(version) from supabase_migrations.schema_migrations) as last_migration;\n',
    '3-rollback-L.sql':
      '-- ОТКАТ миграции L (КОНТРОЛЛЕР). Годится и до, и после K. Проверен заранее\n' +
      '-- 4-dryrun-rollback-L.sql (до apply) и 4b-dryrun-rollback-L-after-apply.sql (после).\n' +
      '-- Запись журнала L остаётся (без оператора удаления): в APPLIED.json — пометка «L откатана\n' +
      '-- 3-rollback-L»; повторное применение L — новой миграцией.\n' +
      "-- Ожидание: commit без ошибок; последний select — 't | f'.\n\n" +
      HEAD + afterL + rollbackL +
      checkMd5('Сверка отката: стражи = B + notes / B', MD5.rollbackL, 'ОТКАТ: страж не равен телу отката') +
      'commit;\n\n' +
      "select to_regclass('public.sales_staff_events') is not null as table_kept,\n" +
      "       (select tgenabled <> 'D' from pg_trigger where tgname = 'profiles_sales_staff_audit') as audit_on;\n",
    '4-dryrun-rollback-L.sql':
      '-- СУХОЙ ПРОГОН ОТКАТА L до apply (КОНТРОЛЛЕР): предусловие, L, K (откат L годится и после K),\n' +
      '-- текст отката, сверка тел, пробы после отката (supabase/rollout/m8/probes-after-rollback-L.sql).\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total2(afterRollbackLProbes)} {…}\n\n` +
      HEAD + preL + '-- ── Миграция L ──\n' + L + '\n-- ── Миграция K ──\n' + K + '\n' + rollbackL +
      checkMd5('Сверка отката: стражи = B + notes / B', MD5.rollbackL, 'ОТКАТ: страж не равен телу отката') +
      '-- ── Пробы после отката L ──\n' + probeBody(afterRollbackLProbes),
    '4b-dryrun-rollback-L-after-apply.sql':
      '-- СУХОЙ ПРОГОН ОТКАТА L после apply (КОНТРОЛЛЕР): тот же откат поверх применённой L, пробы после отката.\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total2(afterRollbackLProbes)} {…}\n\n` +
      HEAD + afterL + rollbackL +
      checkMd5('Сверка отката: стражи = B + notes / B', MD5.rollbackL, 'ОТКАТ: страж не равен телу отката') +
      '-- ── Пробы после отката L ──\n' + probeBody(afterRollbackLProbes),
    '1-dryrun-K.sql':
      `-- СУХОЙ ПРОГОН миграции K (${VERSIONS.K}) + пробы supabase/probes/order_v4_zone_notes.sql. КОНТРОЛЛЕР.\n` +
      '-- После L на бою и выкладки фронта ревизии 4 (окно до K — не больше 30 минут).\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total('order_v4_zone_notes.sql')} {…}. 'Сначала миграция L' /\n` +
      "-- 'не совпадают' — K НЕ применять, разобраться. Всё откатывается.\n\n" +
      HEAD + preK + '-- ── Миграция K ──\n' + K + '\n-- ── Пробы K ──\n' + probes('order_v4_zone_notes.sql'),
    '1b-dryrun-K-regress.sql':
      '-- СУХОЙ ПРОГОН миграции K + регресс прав order_v4_rights.sql (редакция вехи 8, ревизия 4).\n' +
      '-- ВЛАДЕЛЕЦ в SQL Editor (в пробах прав есть удаление строк). Регресс H после K — garment_flats.sql\n' +
      '-- (ревизия 4) отдельным прогоном на бою.\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total('order_v4_rights.sql')} {…}\n\n` +
      HEAD + preK + '-- ── Миграция K ──\n' + K + '\n-- ── Пробы прав (редакция вехи 8) ──\n' + probes('order_v4_rights.sql'),
    '2-apply-K.sql':
      '-- ПРИМЕНЕНИЕ миграции K (КОНТРОЛЛЕР) — после выкладки фронта ревизии 4 (маркер в /version.json),\n' +
      '-- зелёных 1-dryrun-K, 4-dryrun-rollback-K и мутаций K. Не позже 30 минут после выкладки.\n' +
      `-- Ожидание: последний select — 't | ${VERSIONS.K}'. Затем: пробы order_v4_zone_notes.sql на бою,\n` +
      '-- смоук REST (ревизия 3 — «Вышло обновление», 4 — успех и notes в ответе; комментарий после\n' +
      '-- перечитывания на месте), APPLIED.json, npm run migrations:verify.\n' +
      '-- Откат — 3-rollback-K-functions.sql (ДО отката фронта).\n\n' +
      HEAD + preK + '-- ── Миграция K ──\n' + K + '\n' +
      checkMd5('Сверка: обёртка на бою = тексту K', MD5.K, 'APPLY: обёртка не равна тексту K') + journal('K') +
      "select exists (select 1 from information_schema.columns where table_schema = 'public'\n" +
      "                and table_name = 'order_item_prints' and column_name = 'zone_id') as k_on,\n" +
      '       (select max(version) from supabase_migrations.schema_migrations) as last_migration;\n',
    '3-rollback-K-functions.sql':
      '-- ОТКАТ функций K (КОНТРОЛЛЕР) — СНАЧАЛА он, потом откат фронта (Instant Rollback Vercel).\n' +
      '-- Обёртка order_v4_save_full возвращается к телу D (порог ревизии 3, без zone_id и notes).\n' +
      '-- Стражи L не трогаются: запись v3 остаётся закрытой. Колонка zone_id и запись журнала K\n' +
      '-- остаются (nullable, безвредны); колонку снимает 3b-drop-zone-id.sql (владелец, по желанию).\n' +
      "-- Ожидание: commit без ошибок; последний select — 't'.\n\n" +
      HEAD + afterK + rollbackK +
      checkMd5('Сверка отката: обёртка = тело D', MD5.rollbackK, 'ОТКАТ: обёртка не равна телу D') +
      'commit;\n\n' +
      "select md5(prosrc) = '" + MD5.rollbackK['order_v4_save_full(jsonb)'] +
      "' as d_body from pg_proc where oid = to_regprocedure('public.order_v4_save_full(jsonb)');\n",
    '4-dryrun-rollback-K.sql':
      '-- СУХОЙ ПРОГОН ОТКАТА функций K до apply (КОНТРОЛЛЕР): предусловие, K, откат, сверка, пробы\n' +
      '-- после отката (supabase/rollout/m8/probes-after-rollback-K.sql).\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total2(afterRollbackKProbes)} {…}\n\n` +
      HEAD + preK + '-- ── Миграция K ──\n' + K + '\n' + rollbackK +
      checkMd5('Сверка отката: обёртка = тело D', MD5.rollbackK, 'ОТКАТ: обёртка не равна телу D') +
      '-- ── Пробы после отката K ──\n' + probeBody(afterRollbackKProbes),
    '3b-drop-zone-id.sql':
      '-- ВЛАДЕЛЕЦ, по желанию и позже: снять колонку order_item_prints.zone_id после отката функций K.\n' +
      '-- Только если обёртка уже вернулась к телу D (3-rollback-K-functions.sql) — иначе отказ.\n\n' +
      HEAD + doBlock('pre', 'Предусловие: функции K откачены',
        md5Check('order_v4_save_full(jsonb)', MD5.rollbackK['order_v4_save_full(jsonb)'],
          'Обёртка не равна телу D — сначала 3-rollback-K-functions.sql')) +
      'alter table public.order_item_prints drop column if exists zone_id;\n\n' +
      "notify pgrst, 'reload schema';\n\ncommit;\n",
    '1-dryrun-M.sql':
      `-- СУХОЙ ПРОГОН миграции M (${VERSIONS.M}) + пробы supabase/probes/catalog_legacy.sql.\n` +
      '-- ВЛАДЕЛЕЦ в SQL Editor (оператор удаления). Перед прогоном — посмотреть снимок\n' +
      '-- supabase/snapshots/catalog_config_legacy_2026-10-18.json.\n' +
      `-- ОЖИДАНИЕ: ERROR  PROBE_RESULT fails=0 total=${total('catalog_legacy.sql')} {…}. «значения изменились —\n` +
      '-- переснимите» — M НЕ применять: снимок устарел.\n\n' +
      HEAD + preM + '-- ── Миграция M ──\n' + M + '\n-- ── Пробы M ──\n' + probes('catalog_legacy.sql'),
    '2-apply-M.sql':
      '-- ПРИМЕНЕНИЕ миграции M — ВЛАДЕЛЕЦ в SQL Editor, после зелёного 1-dryrun-M и 4-dryrun-rollback-M.\n' +
      `-- Ожидание: последний select — '0 | ${VERSIONS.M}'. Контроллер, увидев M в журнале (SELECT), в той же\n` +
      '-- сессии обновляет APPLIED.json и npm run migrations:verify.\n\n' +
      HEAD + preM + '-- ── Миграция M ──\n' + M + '\n' + journal('M') +
      "select (select count(*) from public.catalog_config where key in ('prices', 'labels', 'extras', 'fabrics')) as legacy_left,\n" +
      '       (select max(version) from supabase_migrations.schema_migrations) as last_migration;\n',
    '3-rollback-M.sql':
      '-- ОТКАТ миграции M — ВЛАДЕЛЕЦ: значения снимка обратно, прежнее условие политики чтения.\n' +
      '-- Запись журнала M остаётся; в APPLIED.json — пометка «M откатана».\n\n' +
      HEAD + afterM + rollbackM + checkM + 'commit;\n',
    '4-dryrun-rollback-M.sql':
      '-- СУХОЙ ПРОГОН ОТКАТА M до apply — ВЛАДЕЛЕЦ: M, откат, сверка значений со снимком по md5.\n' +
      "-- ОЖИДАНИЕ: ERROR  ROLLBACK_M_OK (всё откатывается).\n\n" +
      HEAD + preM + '-- ── Миграция M ──\n' + M + '\n' + rollbackM + checkM +
      "do $$\nbegin\n  raise exception 'ROLLBACK_M_OK';\nend;\n$$;\n",
  };
  return { MD5, files, rollbackGuardBody: rbGuard.body };
}

/** Число проб в файле проб (без шапки) */
function total2(text) {
  return /fails=0 total=(\d+)/.exec(text)[1];
}

// ── Мутации SQL: одна правка, ожидание PROBE_RESULT fails>0 ──────────────
/** `scope`: 'L' — правка текста L, 'K' — правка текста K; `fn` — внутри тела функции или весь файл */
export const MUTATIONS = [
  { name: 'notes-len-check-off', scope: 'L',
    find: 'alter table public.orders\n  add constraint orders_notes_len check (notes is null or char_length(notes) <= 2000) not valid;\n' +
      'alter table public.orders validate constraint orders_notes_len;\n',
    replace: '', kills: 's_notes_2001' },
  { name: 'v3-insert-open', scope: 'L', fn: 'order_v4_guard',
    find: "    if new.schema_version is distinct from 4 then\n      raise exception using errcode = '42501',\n",
    replace: "    if false then\n      raise exception using errcode = '42501',\n", kills: 's_v3_insert / s_v3_insert_default' },
  { name: 'v3-update-open', scope: 'L', fn: 'order_v4_guard',
    find: "  if old.schema_version is distinct from 4 then\n    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';\n",
    replace: "  if false then\n    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';\n",
    kills: 's_v3_update / rop_v3_update' },
  { name: 'v3-remove-skip', scope: 'L', fn: 'order_v4_delete_guard',
    find: "    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';\n",
    replace: '    return old;\n', kills: 'a_v3_remove', probe: 'order_v4_rights.sql' },
  { name: 'v3-before-service', scope: 'L', fn: 'order_v4_guard',
    find: '  -- L:end v3-skip\n',
    replace: "  -- L:end v3-skip\n  if tg_op = 'UPDATE' and old.schema_version is distinct from 4 then\n" +
      "    raise exception using errcode = '42501', message = 'Старые заказы (v3) только для чтения';\n  end if;\n",
    kills: 'svc_v3_update' },
  { name: 'notes-not-draft-field', scope: 'L', fn: 'order_v4_guard',
    find: "    'notes',\n    -- L:end notes-allowed\n", replace: '    -- L:end notes-allowed\n',
    kills: 's_notes_draft' },
  { name: 'events-insert-open', scope: 'L',
    find: 'revoke all on sequence public.sales_staff_events_id_seq from public, anon, authenticated;\n',
    replace: 'grant select, insert on public.sales_staff_events to authenticated;\n' +
      'grant usage on sequence public.sales_staff_events_id_seq to authenticated;\n' +
      'create policy sales_staff_events_m on public.sales_staff_events for insert to authenticated with check (true);\n',
    kills: 's_events_write / rop_events_write' },
  { name: 'events-trigger-off', scope: 'L',
    find: 'create trigger profiles_sales_staff_audit\n  after update of is_sales, is_ms on public.profiles\n' +
      '  for each row execute function public.profiles_sales_staff_audit();\n',
    replace: '', kills: 'svc_event / rop_event' },
  { name: 'comments-open', scope: 'L',
    find: 'revoke all on public.order_comments from public, anon, authenticated;\n',
    replace: '', kills: 's_comments_read (без гранта — 42501; с грантом политика false даёт «OK 0»)' },
  { name: 'rpc-notes-len-off', scope: 'K', fn: 'order_v4_save_full',
    find: "     or char_length(coalesce(p_order->>'notes', '')) > 2000) then\n",
    replace: '     or false) then\n', kills: 'zn_notes_2001 (23514 вместо 22023)' },
  { name: 'rpc-zone-format-off', scope: 'K', fn: 'order_v4_save_full',
    find: "            or (pr.v->>'zone_id') !~ '^[a-z0-9][a-z0-9_-]{0,62}$')) then\n",
    replace: '            or false)) then\n', kills: 'zn_bad_zone / zn_zone_64 (23514 вместо 22023)' },
  { name: 'rpc-rev-3', scope: 'K', fn: 'order_v4_save_full',
    find: "  if coalesce((p_order->>'client_rev')::int, 0) < 4 then\n",
    replace: "  if coalesce((p_order->>'client_rev')::int, 0) < 3 then\n", kills: 'zn_rev3' },
  { name: 'rpc-no-notes-answer', scope: 'K', fn: 'order_v4_save_full',
    find: "'notes', coalesce(v_notes, ''));\n", replace: "'x', 1);\n", kills: 'zn_save / zn_no_key / zn_clear' },
  { name: 'rpc-zone-not-written', scope: 'K', fn: 'order_v4_save_full',
    find: '     and p.zone_id is distinct from z.zone_id;\n', replace: '     and false;\n', kills: 'zn_save_effect' },
];

/** Текст миграции с одной мутацией: каждая правка — ровно один раз (в теле функции или в файле) */
export function mutate(sql, mu) {
  let start = 0;
  let end = sql.length;
  if (mu.fn) {
    start = sql.indexOf(`create or replace function public.${mu.fn}(`);
    start = sql.indexOf('$$', start) + 2;
    end = sql.indexOf('$$', start);
  }
  const part = sql.slice(start, end);
  const n = part.split(mu.find).length - 1;
  if (n !== 1) throw new Error(`${mu.name}: строка найдена ${n} раз`);
  return sql.slice(0, start) + part.replace(mu.find, () => mu.replace) + sql.slice(end);
}

function writeMutations(dir) {
  mkdirSync(dir, { recursive: true });
  const L = migrationText('L');
  const K = migrationText('K');
  const pr = (f) => probeBody(read(join(PROBES, f)));
  const { files } = build();
  const between = (f, a, b) => f.slice(f.indexOf(a) + a.length, f.indexOf(b));
  const preL = between(files['1-dryrun-L.sql'], HEAD, '-- ── Миграция L ──');
  const preK = between(files['1-dryrun-K.sql'], HEAD, '-- ── Миграция K ──');
  MUTATIONS.forEach((mu, i) => {
    const n = i + 1;
    const body = mu.scope === 'L'
      ? preL + '-- ── L с мутацией ──\n' + mutate(L, mu) + `\n-- ── Пробы ${mu.probe ?? 'order_v3_readonly.sql'} ──\n` +
        pr(mu.probe ?? 'order_v3_readonly.sql')
      : preK + '-- ── K с мутацией ──\n' + mutate(K, mu) + '\n-- ── Пробы K ──\n' + pr('order_v4_zone_notes.sql');
    const text = `-- Мутация ${mu.scope} №${n} «${mu.name}». СУХОЙ ПРОГОН: всё откатывается. ВЛАДЕЛЕЦ или локально.\n` +
      `-- ОЖИДАНИЕ: PROBE_RESULT fails>0, краснеет ${mu.kills}\n` +
      '-- Сгенерировано supabase/rollout/m8/build.mjs — не править руками.\n\n' + HEAD + body;
    writeFileSync(join(dir, `1m-${n}-${mu.name}-mutation-${mu.scope}.sql`), text);
  });
  return MUTATIONS.length;
}

function main() {
  const { files } = build();
  for (const [name, text] of Object.entries(files)) writeFileSync(join(HERE, name), text);
  console.log(`файлов выкатки: ${Object.keys(files).length}`);
  const i = process.argv.indexOf('--mutations');
  if (i > 0) {
    const dir = process.argv[i + 1];
    if (!dir || resolve(dir).startsWith(resolve(ROOT))) {
      console.error('каталог мутаций — вне репозитория');
      process.exit(1);
    }
    console.log(`мутаций: ${writeMutations(dir)} → ${dir}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
