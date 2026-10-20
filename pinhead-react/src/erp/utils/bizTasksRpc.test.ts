// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { functionBody, migration, withoutComments } from './migrations.testutil';
import { BIZ_TASK_STATUSES, BIZ_TASK_TRANSITIONS } from './bizTasks';

/**
 * БИЗНЕС-ЗАДАЧИ: ПИСАТЕЛИ (правки 19.10, п. 7; миграция T2).
 *
 * Клиент задачу только читает; пишут `security definer` RPC, и событие
 * истории с уведомлениями ложится той же транзакцией. Значит, весь доступ —
 * в телах этих функций, и сторож проверяет именно их: кому выставлены,
 * через какую проверку идут управляющие действия, какие ключи принимает
 * создание и правка, кому уходят уведомления. Поведение на базе — проба
 * `supabase/probes/erp_biz_tasks.sql`; матрица её переходов строится
 * генератором из той же таблицы `BIZ_TASK_TRANSITIONS`, что ведёт кнопки.
 */

const FILE = '20261020100000_erp_biz_tasks_rpc.sql';
const RAW = migration(FILE);
const SQL = withoutComments(RAW);
const PROBES = join(process.cwd(), '../supabase/probes');

/** Выставлены клиенту — ровно эти */
const WRITERS = [
  'erp_biz_task_create',
  'erp_biz_task_transition',
  'erp_biz_task_update',
  'erp_biz_task_set_result',
  'erp_biz_task_checklist_op',
  'erp_biz_task_attach',
  'erp_biz_task_mark_seen',
  'erp_biz_task_seen_by',
  'erp_biz_task_counts',
];

/** Служебные помощники — EXECUTE никому: зовутся только изнутри писателей */
const HELPERS = [
  'erp_profile_is_staff',
  'erp_biz_task_can_manage',
  'erp_biz_task_gate',
  'erp_biz_task_is_participant',
  'erp_biz_task_log',
  'erp_biz_task_notify',
];

/**
 * T3 в том же файле (лимит неприменённых ≤ 5): функции чата с веткой задачи
 * выставлены клиенту; напоминания — только service_role (`pg_cron`)
 */
const CHAT = [
  'erp_chat_send',
  'erp_chat_page',
  'erp_chat_unread_tasks',
  'erp_chat_edit',
  'erp_chat_delete',
];
const SERVICE = ['erp_biz_task_reminders_run'];
/** Читают под RLS вызывающего — invoker */
const INVOKERS = ['erp_biz_task_counts', 'erp_chat_page', 'erp_chat_unread_tasks'];

/** Заголовок функции — от `create` до начала тела */
function header(fn: string): string {
  const at = SQL.indexOf(`create or replace function public.${fn}(`);
  if (at < 0) throw new Error(`нет функции ${fn}`);
  const end = /\sas \$/.exec(SQL.slice(at));
  if (!end) throw new Error(`нет тела ${fn}`);
  return SQL.slice(at, at + end.index);
}

const body = (fn: string): string => withoutComments(functionBody(SQL, fn));

/** Массив строк из объявления `<name> constant text[] := array[…]` */
function constArray(fn: string, name: string): string[] {
  const m = new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`).exec(body(fn));
  if (!m) throw new Error(`${fn}: нет ${name}`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('писатели бизнес-задач: кому выставлены', () => {
  it('писатели — definer, revoke у public/anon/authenticated, grant — только белому списку', () => {
    const defined = [...SQL.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect([...new Set(defined)].sort()).toEqual([...WRITERS, ...HELPERS, ...CHAT, ...SERVICE].sort());

    for (const fn of [...WRITERS, ...HELPERS, ...CHAT, ...SERVICE]) {
      const h = header(fn);
      expect(h, `${fn}: search_path`).toMatch(/set search_path = public/);
      if (INVOKERS.includes(fn)) {
        // Счётчики и лента — invoker: читают под RLS вызывающего, обходить её незачем
        expect(h).not.toMatch(/security definer/);
      } else {
        expect(h, `${fn}: security definer`).toMatch(/security definer/);
      }
      expect(SQL, `${fn}: revoke у всех трёх`).toMatch(
        new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`),
      );
    }

    const granted = [...SQL.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([\w, ]+);/g)];
    expect(granted.map((m) => m[1]).sort()).toEqual([...WRITERS, ...CHAT, ...SERVICE].sort());
    for (const m of granted) {
      expect(m[2], m[1]).toBe(SERVICE.includes(m[1]) ? 'service_role' : 'authenticated');
    }
    expect(SQL).not.toMatch(/grant execute on function [^;]*\bto (anon|public)\b/);
  });

  it('каждый писатель начинается с ворот: участник ERP с записью сотрудника', () => {
    for (const fn of WRITERS.filter((f) => f !== 'erp_biz_task_counts')) {
      expect(body(fn), fn).toMatch(/:= public\.erp_biz_task_gate\(\)/);
    }
    const gate = body('erp_biz_task_gate');
    expect(gate).toMatch(/public\.erp_is_member\(\)/);
    expect(gate).toMatch(/public\.erp_profile_is_staff\(v_me\)/);
    expect(gate).toMatch(/errcode = '42501'/);
  });

  it('erp_biz_task_counts: просрочка — правило клиентского isOverdue для открытых', () => {
    const b = body('erp_biz_task_counts');
    expect(b).toMatch(/\(t\.status in \('new', 'in_progress', 'paused'\) and t\.due_at < now\(\)\)/);
    expect(b).toMatch(/\(t\.status = 'review' and t\.submitted_at > t\.due_at\)/);
    // завершённая считается в done, в просроченные не входит
    const overdue = b.slice(b.indexOf('(t.status in (\'new\', \'in_progress\', \'paused\') and t.due_at'), b.indexOf('filter (where t.status = \'done\')'));
    expect(overdue).not.toMatch(/'done'/);
  });

  it('erp_profile_is_staff: активный, одобренный, с активной записью erp_employees', () => {
    const b = body('erp_profile_is_staff');
    expect(b).toMatch(/p\.active is true and p\.approved is true/);
    expect(b).toMatch(/from public\.erp_employees e\s+where e\.profile_id = p_user and e\.active is true/);
  });
});

describe('управляющие действия — только по должности (ревизия безопасности B1)', () => {
  it('erp_biz_task_can_manage: право И запись erp_employees (admin/director профиля — допущены)', () => {
    const b = body('erp_biz_task_can_manage');
    expect(b).toMatch(/public\.erp_has_permission\('biz_task\.manage'\)/);
    expect(b).toMatch(/public\.erp_profile_is_staff\(\(select auth\.uid\(\)\)\)/);
    expect(b).toMatch(/p\.role in \('admin', 'director'\)/);
  });

  it('голого erp_has_permission в писателях нет — только через erp_biz_task_can_manage()', () => {
    for (const fn of [...WRITERS, ...HELPERS].filter((f) => f !== 'erp_biz_task_can_manage')) {
      expect(body(fn), fn).not.toMatch(/erp_has_permission\(/);
    }
    for (const fn of [
      'erp_biz_task_transition', 'erp_biz_task_update', 'erp_biz_task_checklist_op',
      'erp_biz_task_attach', 'erp_biz_task_seen_by',
    ]) {
      expect(body(fn), fn).toMatch(/public\.erp_biz_task_can_manage\(\)/);
    }
  });
});

describe('переходы: одна таблица на клиенте, в писателе и в пробе', () => {
  it('таблица в erp_biz_task_transition = BIZ_TASK_TRANSITIONS', () => {
    const b = body('erp_biz_task_transition');
    const rows = [...b.matchAll(
      /\('(\w+)',\s*'\{([a-z_,]+)\}'::text\[\],\s*'(\w+)',\s*'(\w+)',\s*(?:'(\w+)'|null)(?:::text)?\)/g,
    )];
    const server = Object.fromEntries(rows.map((m) => [m[1], {
      from: m[2].split(','), to: m[3], who: m[4], text: m[5] ?? null,
    }]));
    const client = Object.fromEntries(Object.entries(BIZ_TASK_TRANSITIONS).map(([k, v]) => [k, {
      from: [...v.from], to: v.to, who: v.who, text: v.text,
    }]));
    expect(server).toEqual(client);
  });

  it('матрица пробы совпадает с BIZ_TASK_TRANSITIONS', async () => {
    const url = pathToFileURL(join(PROBES, 'gen-biz-task-matrix.mjs')).href;
    const gen = (await import(/* @vite-ignore */ url)) as {
      buildMatrix: (t: typeof BIZ_TASK_TRANSITIONS, s: readonly string[]) => string[];
      MATRIX_BEGIN: string;
      MATRIX_END: string;
    };
    const lines = gen.buildMatrix(BIZ_TASK_TRANSITIONS, BIZ_TASK_STATUSES);
    // 9 действий × 6 статусов × 5 ролей, у submit/complete — ещё «с проверкой / без»
    expect(lines).toHaveLength(7 * 6 * 5 + 2 * 6 * 5 * 2);
    const probe = readFileSync(join(PROBES, 'erp_biz_tasks.sql'), 'utf8');
    const from = probe.indexOf(gen.MATRIX_BEGIN);
    const to = probe.indexOf(gen.MATRIX_END);
    expect(from, 'нет начала блока матрицы').toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const block = probe.slice(from + gen.MATRIX_BEGIN.length, to).trim().split('\n');
    expect(block).toEqual(lines);
    // Каждое ожидание — из трёх: разрешено, неверный переход, чужая роль
    for (const l of lines) expect(l).toMatch(/', '(OK \w+|22023|42501)', pg_temp\.mx\(/);
  });

  it('порядок отказов: версия → действие → роль → статус → проверка постановщиком', () => {
    const b = body('erp_biz_task_transition');
    const at = (re: RegExp): number => {
      const m = re.exec(b);
      if (!m) throw new Error(`нет ${re}`);
      return m.index;
    };
    const version = at(/Задача изменена — обновите карточку/);
    const action = at(/неизвестное действие/);
    const role = at(/v_who = 'assignee'/);
    const status = at(/not \(v_row\.status = any \(v_from\)\)/);
    const review = at(/p_action = 'submit' and not v_row\.review_required/);
    expect(version).toBeLessThan(action);
    expect(action).toBeLessThan(role);
    expect(role).toBeLessThan(status);
    expect(status).toBeLessThan(review);
    expect(b).toMatch(/Задача изменена — обновите карточку' using errcode = 'P0001'/);
  });
});

describe('создание и правка: белые списки и лимиты', () => {
  it('белый список ключей create/update', () => {
    expect(constArray('erp_biz_task_create', 'v_allowed')).toEqual([
      'order_id', 'title', 'kind', 'description', 'assignee_id', 'due_at',
      'review_required', 'watchers', 'checklist',
    ]);
    expect(constArray('erp_biz_task_update', 'v_allowed')).toEqual([
      'title', 'description', 'kind', 'assignee_id', 'due_at', 'due_reason', 'watchers',
    ]);
    const create = body('erp_biz_task_create');
    // Постановщик — всегда вызывающий; присланный creator_id отклоняется списком
    expect(create).toMatch(/creator_id[\s\S]*?v_me/);
    expect(create).not.toMatch(/p_task->>'(creator_id|status|id|result_text)'/);
    expect(create).toMatch(/недопустимые поля/);
  });

  it('повтор client_key — прежняя строка, а не вторая задача', () => {
    const b = body('erp_biz_task_create');
    expect(b).toMatch(/on conflict \(client_key\) do nothing/);
    expect(b).toMatch(/where t\.client_key = p_client_key/);
  });

  it('лимиты Р8 и заказ не сдан/не отменён', () => {
    const b = body('erp_biz_task_create');
    expect(b).toMatch(/v_order_status like 'done%' or v_order_status = 'cancelled'/);
    expect(b).toMatch(/> 20/);
    expect(b).toMatch(/> 100/);
    expect(b).toMatch(/>= 30/);
    expect(b).toMatch(/created_at > now\(\) - interval '1 hour'/);
    expect(body('erp_biz_task_update')).toMatch(/> 20/);
    expect(body('erp_biz_task_checklist_op')).toMatch(/>= 100/);
  });

  it('наблюдатели: переданные ∪ менеджер заказа минус постановщик и ответственный', () => {
    const b = body('erp_biz_task_create');
    expect(b).toMatch(/o\.manager_id into v_order_status, v_manager\s+from public\.erp_orders o/);
    expect(b).toMatch(/where w is distinct from v_me and w is distinct from v_assignee/);
  });

  it('перенос срока — с причиной и прежним значением', () => {
    const b = body('erp_biz_task_update');
    expect(b).toMatch(/'due_changed'/);
    expect(b).toMatch(/'from', v_row\.due_at, 'to', v_due, 'reason', v_reason/);
    expect(b).toMatch(/Задача изменена — обновите карточку' using errcode = 'P0001'/);
  });
});

describe('уведомления и файлы', () => {
  it('уведомления — один писатель: distinct, без автора, только сотрудники, одно на событие', () => {
    // Вне отправки чата (у неё своя рассылка: сделка и `task_mention`) — один писатель
    const send = functionBody(SQL, 'erp_chat_send');
    expect(SQL.replace(send, '').match(/insert into public\.erp_notifications/g)).toHaveLength(1);
    const n = body('erp_biz_task_notify');
    expect(n).toMatch(/insert into public\.erp_notifications/);
    expect(n).toMatch(/select distinct u/);
    expect(n).toMatch(/u is distinct from \(select auth\.uid\(\)\)/);
    expect(n).toMatch(/public\.erp_profile_is_staff\(u\)/);
    expect(n).toMatch(/on conflict \(user_id, task_event_id\) where task_event_id is not null do nothing/);
  });

  it('сдача на проверку: task_review постановщику РАНЬШЕ task_status — одно уведомление ему', () => {
    const b = body('erp_biz_task_transition');
    expect(b.indexOf("'task_review'")).toBeGreaterThan(0);
    expect(b.indexOf("'task_review'")).toBeLessThan(b.indexOf("'task_status'"));
    expect(b).toMatch(/'task_returned'/);
  });

  it('заголовки заморожены на сервере шаблоном {task}/{order} — тексты плана, Task 9', () => {
    const n = body('erp_biz_task_notify');
    expect(n).toMatch(/replace\(replace\(p_title, '\{task\}', '«' \|\| coalesce\(v_title, ''\) \|\| '»'\)/);
    expect(n).toMatch(/'\{order\}'/);
    expect(n).not.toMatch(/p_title \|\| ' — '/);
    // Каждый заголовок каждого вызова несёт название задачи
    const calls = SQL.match(/perform public\.erp_biz_task_notify\([^;]*;/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(9);
    const titles = calls.flatMap((c) => [...c.matchAll(/'([А-ЯЁ][^']*)'/g)].map((m) => m[1]));
    expect(titles.length).toBeGreaterThanOrEqual(13);
    expect(titles.filter((t) => !t.includes('{task}'))).toEqual([]);
    expect(titles).toEqual(expect.arrayContaining([
      'Вам поручена задача {task} · {order}',
      'До срока задачи {task} меньше 24 часов',
      'Задача {task} просрочена',
    ]));
  });

  it('файл задачи: только свой объект erp-attachments с префиксом att/<order>/biz_task/', () => {
    const b = body('erp_biz_task_attach');
    expect(b).toMatch(/o\.bucket_id = 'erp-attachments'/);
    expect(b).toMatch(/coalesce\(o\.owner_id, o\.owner::text\) = v_me::text/);
    expect(b).toMatch(/'att\/' \|\| v_row\.order_id::text \|\| '\/biz_task\/'/);
    expect(b).toMatch(/'biz_task'/);
    expect(b).toMatch(/biz_task_id/);
  });

  it('результат из сообщения: тред этой задачи, автор — ответственный, не удалено', () => {
    const b = body('erp_biz_task_set_result');
    expect(b).toMatch(/t\.task_id = p_id/);
    expect(b).toMatch(/m\.author_id = v_me/);
    expect(b).toMatch(/m\.deleted_at is null/);
    expect(b).toMatch(/'result_changed'/);
  });

  it('пункт чек-листа обязан принадлежать задаче', () => {
    expect(body('erp_biz_task_checklist_op')).toMatch(/c\.task_id = p_id/);
  });

  it('«видел» — только своя строка, статус не трогается', () => {
    const b = body('erp_biz_task_mark_seen');
    expect(b).toMatch(/insert into public\.erp_biz_task_seen \(task_id, user_id\)/);
    expect(b).toMatch(/on conflict \(task_id, user_id\) do nothing/);
    expect(b).not.toMatch(/set status/);
  });
});

describe('миграция T2 + T3: форма файла', () => {
  it('не правит применённое и перечитывает схему', () => {
    expect(SQL).not.toMatch(/\bdrop table\b/);
    expect(SQL).toMatch(/notify pgrst, 'reload schema';/);
    expect(RAW.split('\n')[0]).toMatch(/^-- /);
  });
});
