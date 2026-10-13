-- Правки ПМ (волна 3), правка 3: формальная приёмка материалов складом с числовой
-- сверкой (план vs факт). До завершения приёмки закрой заблокирован (гейт в routes.ts).
-- Проверка качества материала — уже на этапе закроя, не в приёмке.

alter table public.erp_materials
  add column qty_expected numeric,          -- сколько должно было поступить
  add column qty_received numeric,          -- сколько поступило фактически
  add column accept_status text
    check (accept_status in ('accepted_full','accepted_partial','shortage','mismatch','rejected')),
  add column accepted_at date,
  add column accepted_by text,
  add column accept_comment text;

-- Грандфазер: существующие пришедшие материалы считаем принятыми полностью,
-- чтобы гейт приёмки не блокировал заказы, уже находящиеся в производстве.
update public.erp_materials
  set accept_status = 'accepted_full', accepted_at = coalesce(received_at, current_date)
  where status = 'received' and accept_status is null;
