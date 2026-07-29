-- =============================================================
-- Baseline (продолжение): public.order_templates — шаблоны заказов Order Studio
-- =============================================================
-- Таблица создавалась вручную через Dashboard и в миграциях отсутствовала:
-- 20260727230000_orderstudio_rls_perf.sql пишет для неё политики, поэтому
-- реплей с нуля падал на 42P01 (relation "order_templates" does not exist).
--
-- DDL снят с прода (pinhead-os-v2) 2026-07-29: information_schema.columns,
-- pg_constraint, pg_indexes, pg_policies. Файл идемпотентен — на проде no-op.
-- Политики здесь НЕ создаются: их актуальную (оптимизированную) редакцию
-- задаёт 20260727230000_orderstudio_rls_perf.sql ниже по порядку.

create table if not exists public.order_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid,
  data jsonb not null,
  created_at timestamptz default now()
);

alter table public.order_templates enable row level security;
