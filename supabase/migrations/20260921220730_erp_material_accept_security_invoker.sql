-- Явный `security invoker` у приёмки материалов (правка 21.09, п. 2 — хвост).
--
-- Сначала атрибут был переставлен `alter function`: состояние базы стало
-- верным сразу. Но сторож `materialReceipts.test.ts` читает ТЕКСТ последней
-- миграции, объявляющей функцию, и `alter` он не видит — поэтому следом
-- идёт 20260921221326 с полным определением. Две записи вместо одной:
-- применённое задним числом не переписывают.

alter function public.erp_material_accept(
  uuid, text, numeric, text, text, date, text, text, text, text, uuid, jsonb, integer, jsonb
) security invoker;
