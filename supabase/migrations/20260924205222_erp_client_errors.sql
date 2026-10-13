/**
 * Встроенный приёмник ошибок интерфейса (обзор 24.09, сессия 67, п. 7).
 *
 * `lib/errorReport` с июля умеет слать отчёт на внешний адрес
 * (`VITE_ERROR_REPORT_URL`), но без адреса молчит, и о белом экране в цеху
 * по-прежнему узнают по телефону. Внешний сервис — отдельный аккаунт
 * и решение владельца; эта таблица работает сразу и ничего не требует.
 *
 * ПИШЕТ ТОЛЬКО ВОШЕДШИЙ И ТОЛЬКО ОТ СВОЕГО ИМЕНИ. Вставка для `anon` дала бы
 * открытую запись в базу любому, кто нашёл ключ в бандле. `user_id`
 * по умолчанию `auth.uid()`, и политика не даёт подставить чужой.
 *
 * ЧИТАЕТ ТОТ ЖЕ, КОМУ ВИДНА ВКЛАДКА: `staff.invite` — ровно её гейт
 * в `AdminScreen`. Стек и адрес экрана — служебные сведения, а не данные цеха.
 *
 * НИ UPDATE, НИ DELETE. Отчёт — факт, а не рабочая запись; править его
 * некому и незачем. Объём держит клиент: не больше 20 отчётов за сессию
 * и без повторов одной ошибки; CHECK на длины — последняя линия, если клиент
 * это правило потеряет.
 */
create table if not exists public.erp_client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references public.profiles(id) on delete set null,
  source text not null check (char_length(source) <= 40),
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 4000),
  url text check (char_length(url) <= 1000),
  release text check (char_length(release) <= 100),
  user_agent text check (char_length(user_agent) <= 400)
);

create index if not exists erp_client_errors_created_idx
  on public.erp_client_errors (created_at desc);
create index if not exists erp_client_errors_user_idx
  on public.erp_client_errors (user_id);

alter table public.erp_client_errors enable row level security;

revoke all on public.erp_client_errors from anon;

create policy erp_client_errors_insert on public.erp_client_errors
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy erp_client_errors_select on public.erp_client_errors
  for select to authenticated
  using ((select public.erp_has_permission('staff.invite')));
