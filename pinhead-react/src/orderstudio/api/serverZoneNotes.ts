/**
 * Сервер знает `zone_id` нанесения и `notes` заказа (веха 8, миграция K; К5) —
 * окно «фронт ревизии 4 → K».
 *
 * Старый `order_v4_save` читает поля явно и молча пропускает новые: форма
 * ответила бы успехом, а после F5 поле пустое. Поэтому клиент шлёт `zone_id`
 * и `notes` (и показывает «Комментарий для цехов») только когда сервер их
 * знает: ответ `order_v4_save_full` несёт ключ `notes` (его добавляет K) или
 * строки нанесений при чтении несут колонку `zone_id` (её заводит K).
 * Колонка `orders.notes` была и до K — по ней одной судить нельзя.
 * Метка — на вкладку: миграция действует для всех заказов сразу.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- строка PostgREST нетипизирована */
type Row = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

let serverZoneNotes = false;

export function serverKnowsZoneNotes(): boolean {
  return serverZoneNotes;
}

export function markServerZoneNotes(): void {
  serverZoneNotes = true;
}

/** Только для тестов */
export function __resetServerZoneNotesForTests(): void {
  serverZoneNotes = false;
}

/** Строка заказа (вложенный select) пришла с колонкой `zone_id` у нанесений — сервер после K */
export function rowKnowsZoneNotes(r: Row): boolean {
  const items = Array.isArray(r?.order_items) ? r.order_items : [];
  return items.some((it: Row) => (Array.isArray(it?.order_item_prints) ? it.order_item_prints : [])
    .some((p: Row) => p && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, 'zone_id')));
}
