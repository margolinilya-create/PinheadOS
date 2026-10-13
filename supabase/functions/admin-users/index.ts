/**
 * Администрирование учётных записей: создание, пароль, адрес, удаление.
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ ФУНКЦИЯ. Всё это умеет только Admin API GoTrue, а он
 * требует `service_role`. Этот ключ обходит RLS целиком, поэтому в браузер
 * он не попадает НИКОГДА — ни в `.env` фронтенда, ни в бандл. Единственный
 * способ дать админу сменить пароль сотруднику — сервер, который держит ключ
 * у себя и сам проверяет, кто его позвал.
 *
 * ГЕЙТ — `is_admin()`, вызванная ОТ ЛИЦА ВЫЗЫВАЮЩЕГО. Не «проверим роль сами»:
 * своя реализация проверки разошлась бы с политикой `profiles` в первый же раз,
 * когда ту поправят (в проекте такое уже ловилось — `isPrivileged` против
 * `is_admin()`). Здесь вызывается ровно та функция, на которой стоят политики
 * таблицы `profiles`, поэтому расхождению взяться неоткуда.
 *
 * РОЛЬ НОВОМУ СОТРУДНИКУ ПРОСТАВЛЯЕТ ТОТ ЖЕ ПУТЬ, ЧТО И ПРИГЛАШЕНИЮ:
 * функция заводит одноразовый `erp_invites` и кладёт его код в метаданные
 * создаваемого пользователя. Роль, цех и одобрение проставит триггер
 * `handle_new_user` — единственное место, где это вообще происходит. Вторая
 * реализация («создать, потом дописать профиль») разъехалась бы с первой.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Минимальная длина пароля — та же, что в `utils/validate` на клиенте */
const MIN_PASSWORD = 6;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const fail = (message: string, status = 400) => json({ error: message }, status);

interface Payload {
  action?: string;
  user_id?: string;
  email?: string;
  password?: string;
  name?: string;
  profile_role?: string;
  employee_role?: string;
  department_id?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('Метод не поддерживается', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return fail('Нужен вход в систему', 401);

  // Клиент «от лица вызывающего»: и личность, и права берём у него, а не из тела
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser();
  const callerId = userData?.user?.id;
  if (userError || !callerId) return fail('Сессия недействительна, войдите заново', 401);

  const { data: isAdmin, error: adminError } = await caller.rpc('is_admin');
  if (adminError) return fail('Не удалось проверить права', 500);
  if (isAdmin !== true) return fail('Доступ только у администратора', 403);

  // Ключ обходит RLS — с этого места каждое действие уже проверено выше
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return fail('Тело запроса не разобрано');
  }

  switch (payload.action) {
    case 'create': return createUser(admin, callerId, payload);
    case 'set_password': return setPassword(admin, payload);
    case 'set_email': return setEmail(admin, payload);
    case 'delete': return deleteUser(admin, callerId, payload);
    default: return fail(`Неизвестное действие: ${payload.action ?? '—'}`);
  }
});

type Admin = ReturnType<typeof createClient>;

/**
 * Создание учётной записи с готовым паролем.
 *
 * `email_confirm: true` обязателен: без него GoTrue ждёт перехода по письму,
 * а письма шлёт встроенный SMTP (порядка двух в час, у gmail спам) — ровно то,
 * от чего проект ушёл, заведя приглашения. Админ задал пароль сам, значит
 * подтверждать адрес письмом нечего.
 */
async function createUser(admin: Admin, callerId: string, p: Payload) {
  const email = (p.email ?? '').trim().toLowerCase();
  const password = p.password ?? '';
  const name = (p.name ?? '').trim();

  if (!email) return fail('Укажите email');
  if (password.length < MIN_PASSWORD) return fail(`Пароль — минимум ${MIN_PASSWORD} символов`);
  if (!name) return fail('Укажите имя');

  // Код живёт час и привязан к адресу: он нужен ровно на один вызов ниже
  const { data: invite, error: inviteError } = await admin
    .from('erp_invites')
    .insert({
      profile_role: p.profile_role ?? 'manager',
      employee_role: p.employee_role ?? 'worker',
      department_id: p.department_id ?? null,
      email,
      note: 'Заведён администратором вручную',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_by: callerId,
    })
    .select('code')
    .single();

  if (inviteError || !invite) return fail('Не удалось подготовить роль для нового сотрудника', 500);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, invite_code: invite.code },
  });

  if (createError || !created?.user) {
    // Неиспользованный код гасим сразу: висящее приглашение — это открытая дверь
    await admin.from('erp_invites').update({ revoked_at: new Date().toISOString() })
      .eq('code', invite.code);
    const already = createError?.code === 'email_exists'
      || /already/i.test(createError?.message ?? '');
    return fail(
      already
        ? 'Учётная запись с таким адресом уже есть — откройте её в списке'
        : `Не удалось создать доступ: ${createError?.message ?? 'неизвестная ошибка'}`,
      already ? 409 : 500,
    );
  }

  /**
   * Профиль пишет ТРИГГЕР, а не мы. Раз так — надо убедиться, что он отработал
   * и код погасил: молча выданная роль «менеджер по умолчанию» вместо выбранной
   * означала бы человека с чужими правами, о чём никто бы не узнал.
   */
  const { data: profile } = await admin
    .from('profiles').select('role, approved').eq('id', created.user.id).maybeSingle();

  if (!profile) return fail('Доступ создан, но профиль не появился — проверьте список', 500);
  if (profile.role !== (p.profile_role ?? 'manager') || profile.approved !== true) {
    return fail(
      'Доступ создан, но роль проставилась не та — откройте карточку и задайте её вручную',
      500,
    );
  }

  return json({ id: created.user.id });
}

/** Смена пароля: единственный способ вернуть человека в систему без письма */
async function setPassword(admin: Admin, p: Payload) {
  const password = p.password ?? '';
  if (!p.user_id) return fail('Не указан пользователь');
  if (password.length < MIN_PASSWORD) return fail(`Пароль — минимум ${MIN_PASSWORD} символов`);

  const { error } = await admin.auth.admin.updateUserById(p.user_id, { password });
  if (error) return fail(`Не удалось сменить пароль: ${error.message}`, 500);
  return json({ ok: true });
}

/**
 * Смена адреса меняет ЛОГИН, поэтому идёт и в `auth.users`, и в `profiles`:
 * список пользователей читает второе, а вход проверяет первое, и разъехавшись
 * они дают «человек в списке есть, войти не может».
 */
async function setEmail(admin: Admin, p: Payload) {
  const email = (p.email ?? '').trim().toLowerCase();
  if (!p.user_id) return fail('Не указан пользователь');
  if (!email) return fail('Укажите email');

  const { error } = await admin.auth.admin.updateUserById(p.user_id, {
    email,
    email_confirm: true,
  });
  if (error) {
    const already = error.code === 'email_exists' || /already/i.test(error.message);
    return fail(
      already ? 'Этот адрес занят другой учётной записью' : `Не удалось сменить адрес: ${error.message}`,
      already ? 409 : 500,
    );
  }

  const { error: profileError } = await admin.from('profiles').update({ email }).eq('id', p.user_id);
  if (profileError) return fail('Адрес входа сменён, но список не обновился — перезагрузите страницу', 500);

  return json({ ok: true });
}

/**
 * Безвозвратное удаление.
 *
 * Обычный путь в проекте — мягкое отключение (`active = false`), и оно
 * остаётся: у отключённого сохраняется история, его можно вернуть. Удаление
 * нужно ровно для одного случая — учётная запись заведена по ошибке и ей
 * никто не пользовался. Поэтому:
 *
 * - себя удалить нельзя: админ, оставшийся без админа, — это работа руками
 *   в дашборде Supabase;
 * - заказы держат удаление: `created_by` объявлен `on delete no action`,
 *   и попытка всё равно упала бы, но уже наполовину — после `auth.users`.
 *   Проверяем ДО, чтобы сообщение называло причину;
 * - `profiles` не связан с `auth.users` внешним ключом вовсе, поэтому строку
 *   профиля убираем ЯВНО. Иначе в списке остаётся человек, которого больше
 *   нет, и «Отключить» на нём ничего не делает.
 */
async function deleteUser(admin: Admin, callerId: string, p: Payload) {
  if (!p.user_id) return fail('Не указан пользователь');
  if (p.user_id === callerId) return fail('Себя удалить нельзя', 409);

  const [erpOrders, studioOrders] = await Promise.all([
    admin.from('erp_orders').select('id', { count: 'exact', head: true }).eq('created_by', p.user_id),
    admin.from('orders').select('id', { count: 'exact', head: true }).eq('created_by', p.user_id),
  ]);
  const orders = (erpOrders.count ?? 0) + (studioOrders.count ?? 0);
  if (orders > 0) {
    return fail(
      `За человеком числятся заказы (${orders}) — удалить нельзя, иначе они осядут без автора. `
      + 'Отключите доступ: история сохранится, войти он не сможет.',
      409,
    );
  }

  // Строка сотрудника ссылается на профиль `on delete no action` — снимаем первой
  const { error: empError } = await admin.from('erp_employees').delete().eq('profile_id', p.user_id);
  if (empError) return fail('Не удалось убрать сотрудника из цеха', 500);

  const { error: profileError } = await admin.from('profiles').delete().eq('id', p.user_id);
  if (profileError) return fail(`Не удалось удалить профиль: ${profileError.message}`, 500);

  const { error } = await admin.auth.admin.deleteUser(p.user_id);
  if (error) return fail(`Профиль удалён, но доступ остался: ${error.message}`, 500);

  return json({ ok: true });
}
