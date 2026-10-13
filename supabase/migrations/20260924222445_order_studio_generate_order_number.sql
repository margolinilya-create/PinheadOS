-- generate_order_number: номер заказа Order Studio из последовательности
-- (обзор проекта 24.09, находка 10; решение владельца 24.09, сессия 68).
--
-- ЧТО БЫЛО НЕ ТАК. `useOrdersStore.generateOrderNumber` зовёт RPC
-- `generate_order_number`, а такой функции не было ни в миграциях, ни на бою.
-- Вызов обёрнут запасным путём, поэтому отказ не виден: КАЖДЫЙ заказ
-- Order Studio получал номер `PH-<миллисекунды>-xxxx` (на бою одна такая
-- строка, 26.08). Нашёл сторож `schemaNames.test.ts` (сессия 67) и держал
-- имя в списке известных расхождений до решения владельца.
--
-- ПОСЛЕДОВАТЕЛЬНОСТЬ НЕ НОВАЯ. `order_number_seq` заведена базовой схемой
-- (`20260101000000_baseline_order_studio.sql`), и из неё же берёт номер
-- умолчание колонки `orders.order_number`. Функция читает ТУ ЖЕ
-- последовательность: вторая завела бы два независимых счётчика одного
-- номера, и путь через RPC и путь через умолчание раздали бы одинаковые
-- `PH-0019`.
--
-- ФОРМАТ ОДИН, И ОН ЗДЕСЬ. Умолчание колонки форматировало номер через
-- `lpad(…, 4, '0')`, а `lpad` ОБРЕЗАЕТ строку длиннее заданной: 10000-й заказ
-- получил бы `PH-1000`, а 12345-й и 123456-й — оба `PH-1234` (проверено на бою
-- выражением, без обращения к последовательности). Функция дополняет нулями
-- до четырёх знаков и не режет, а умолчание колонки переводится на саму
-- функцию — формат номера живёт в одном месте, а не в двух копиях, которые
-- однажды разойдутся.
--
-- ПРАВА. `security invoker`: повышать нечего — `nextval` требует USAGE
-- на последовательность, и у `authenticated` оно есть. Исполнение отзывается
-- у PUBLIC и anon (отзыв у одного anon не работает: право приходит от PUBLIC)
-- и выдаётся `authenticated` — клиенту — и `service_role`: умолчание колонки
-- исполняется от лица вставляющего, и вставка через SQL под service_role
-- не должна падать на 42501.
--
-- Номер уже существующей строки (`PH-1787732397234-160n`) не переписывается:
-- номер, который люди видели и называли, меняться не должен.

create or replace function public.generate_order_number()
returns text
language sql
volatile
security invoker
set search_path to 'public'
as $function$
  select 'PH-' || lpad(s.n::text, greatest(4, length(s.n::text)), '0')
    from (select nextval('public.order_number_seq') as n) s;
$function$;

comment on function public.generate_order_number() is
  'Номер заказа Order Studio (PH-0001…) из order_number_seq. Тот же формат даёт умолчание orders.order_number — оно зовёт эту функцию';

revoke execute on function public.generate_order_number() from public, anon;
grant execute on function public.generate_order_number() to authenticated, service_role;

alter table public.orders
  alter column order_number set default public.generate_order_number();
