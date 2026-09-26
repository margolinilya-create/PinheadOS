/**
 * Помощники канала realtime, вынесенные из `realtimeSlice` 26.09 (ратчет
 * размера файла): отписка с проглоченным отказом и точечный патч дочерней
 * строки заказа. Логики применения событий здесь нет — она в слайсе.
 */

import { supabase } from '../../lib/supabase';
import type { ErpOrderFull } from './types';
import type { ChildKey } from './slices/realtimeSlice';

/**
 * Отписка от канала — АСИНХРОННАЯ операция, и её отказ никто не ждёт.
 *
 * `supabase.removeChannel()` возвращает промис; вызванный голым, при отказе
 * он всплывает необработанным — ровно тот класс, от которого в проекте уже
 * обёрнуто фоновое сохранение формы. Нашёл это не человек, а включённый
 * 15.09 `@typescript-eslint/no-floating-promises`: два вызова, оба в путях
 * уборки (переподключение и размонтирование).
 *
 * Сообщать не о чем: отписка от канала, который и так оборван, — нормальный
 * исход, а второй тост на потерянной связи превратил бы оболочку в мигалку.
 * `void` здесь не годится: он гасит ПРАВИЛО, а не отказ промиса.
 */
export function dropChannel(channel: Parameters<typeof supabase.removeChannel>[0]) {
  supabase.removeChannel(channel).catch(() => { /* канал уже мёртв — уборке это не мешает */ });
}

/**
 * Точечный upsert/удаление дочерней строки заказа (материал/закупка/склад).
 * Раньше эти события вызывали полный loadOne заказа — а он затирал оптимистичные
 * мутации ЭТАПОВ, если прилетал во время незавершённой мутации (регрессия волны 4.1:
 * триггер складских задач шлёт события на каждом переходе этапа). Точечный патч
 * массива готовность этапов не ломает (она считается из материалов при рендере).
 */
export function upsertChildRow(
  order: ErpOrderFull, key: ChildKey, row: Record<string, unknown>, id: string, eventType: string,
): ErpOrderFull {
  const list = (order[key] ?? []) as { id: string }[];
  let next: unknown[];
  if (eventType === 'DELETE') next = list.filter((r) => r.id !== id);
  else if (list.some((r) => r.id === id)) next = list.map((r) => (r.id === id ? { ...r, ...row } : r));
  else next = [...list, row];
  return { ...order, [key]: next };
}
