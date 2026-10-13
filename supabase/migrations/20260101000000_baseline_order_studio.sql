-- =============================================================
-- Baseline: базовая схема Order Studio (orders/profiles и спутники)
-- =============================================================
-- Эти таблицы исторически создавались вручную через Dashboard
-- (supabase-config.sql) и в миграциях отсутствовали, из-за чего
-- реплей миграций с нуля (Supabase Preview Branches) падал на первом
-- же файле, ссылающемся на orders/profiles.
--
-- Файл идемпотентен: на проде (pinhead-os-v2), где всё уже существует,
-- каждая инструкция — no-op. На свежей preview-ветке он создаёт базу,
-- достаточную для реплея последующих миграций.
-- DDL снят с прода 2026-07-17.

create sequence if not exists order_number_seq;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'manager',
  email text,
  approved boolean default true,
  created_at timestamptz default now(),
  active boolean not null default true,
  sub_role text,
  assigned_section_id uuid
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id),
  order_number text default ('PH-' || lpad(nextval('order_number_seq')::text, 4, '0')),
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  bitrix_deal text,
  total_sum integer default 0,
  total_qty integer default 0,
  item_type text,
  artwork_link text,
  notes text
);

create table if not exists public.order_comments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  author_name text not null,
  author_role text not null,
  text text not null,
  created_at timestamptz default now()
);

create table if not exists public.app_config (
  key text primary key,
  value jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.catalog_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now(),
  updated_by uuid
);

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_comments enable row level security;
alter table public.app_config enable row level security;
alter table public.catalog_config enable row level security;

-- Функция ролей: используется политиками ERP-миграций ниже по порядку.
-- Определение идентично продовому (CREATE OR REPLACE — no-op на проде).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path to 'public'
as $$
    select exists (
      select 1 from profiles
      where id = auth.uid() and role = 'admin'
    );
$$;
