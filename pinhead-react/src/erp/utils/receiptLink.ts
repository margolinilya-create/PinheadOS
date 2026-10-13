import type { ErpMaterial, ErpWarehouseTask } from '../types';
import type { ErpOrderFull } from '../store/types';

/**
 * СВЯЗЬ ЗАКУПКИ С ПРИЁМКОЙ (правка заказчика 05.10, п. 7).
 *
 * «У позиции закупки — переход к её приёмкам: для ожидаемой поставки
 * „Принять поставку", для принятой „Открыть приёмку". Если приёмка уже
 * есть — открывать её, а не создавать ещё одну».
 *
 * Приёмка принадлежит ПОЗИЦИИ закупки: задачу `material_receipt` с этим
 * `material_id` заводит переход позиции в «В пути» (правка 12.09). Значит,
 * «открыть приёмку» — это открыть ЕЁ задачу, а не завести новую: вторая
 * задача на ту же позицию означала бы второй вход в один журнал приходов.
 * Повторное открытие уже принятой поставки ничего не добавляет — приход
 * пишет только сохранение формы (`erp_material_accept`), а не переход.
 *
 * Чистые функции: одно правило на строку таблицы закупки, карточку планшета
 * и экран склада. Разошедшиеся подписи («Принять» здесь, «Открыть» там)
 * и были бы тем «везде одинаковым „Открыть"», на которое жалоба п. 8.
 */

/** Задача приёмки позиции закупки; нет её — `null` */
export function materialReceiptTask(
  order: Pick<ErpOrderFull, 'warehouse_tasks'>,
  materialId: string,
): ErpWarehouseTask | null {
  return (order.warehouse_tasks ?? []).find(
    (t: ErpWarehouseTask) => t.task_type === 'material_receipt' && t.material_id === materialId,
  ) ?? null;
}

export interface ReceiptAction {
  label: string;
  disabled: boolean;
  /** Почему кнопка недоступна — показывается подсказкой, а не прячется */
  hint: string | null;
}

/** Подсказка недоступной кнопки — дословно из постановки п. 7 */
export const RECEIPT_TASK_MISSING_HINT = 'Задача приёмки появится, когда поставка будет в пути';

/**
 * Действие приёмки в строке закупки.
 *
 * `null` — у позиции приёмки не бывает вовсе: материал со склада
 * подтверждается кнопкой «Наличие», давальческое и «без закупки» склад
 * этой задачей не принимает. Кнопка там была бы действием без работы.
 *
 * Задачи ещё нет (позиция не «В пути») — кнопка ВИДНА, но погашена
 * и объясняет почему: пропавшая кнопка читается как поломка, и закупщик
 * искал бы приёмку на складе вручную — ровно то, от чего уходит пункт.
 */
export function receiptAction(
  m: Pick<ErpMaterial, 'source'> & { accept_status?: ErpMaterial['accept_status'] | null },
  task: Pick<ErpWarehouseTask, 'status'> | null,
): ReceiptAction | null {
  if (!task && m.source !== 'purchase') return null;
  if (!task) return { label: 'Принять поставку', disabled: true, hint: RECEIPT_TASK_MISSING_HINT };
  /**
   * Частично принятая позиция ждёт следующей поставки, даже если задачу
   * успели закрыть (так делал склад до 09.10): «осталось 60 кг» рядом
   * с «Открыть приёмку» читалось как «принимать больше нечего».
   */
  if (task.status === 'accepted' && m.accept_status !== 'accepted_partial') {
    return { label: 'Открыть приёмку', disabled: false, hint: null };
  }
  return { label: 'Принять поставку', disabled: false, hint: null };
}

/**
 * Адрес приёмки на складе.
 *
 * `back` — строка запроса экрана закупки (без `?`): поиск, вкладка
 * и страница, с которых человек ушёл. Склад по ней ведёт ссылку
 * «← К закупке» — «возврат ведёт в ту же закупку, с теми же фильтрами».
 * Путь возврата фиксирован (`/purchasing`), из адреса берётся только
 * запрос — подставить чужой путь через `back` нельзя.
 */
export function receiptHref(taskId: string, orderId: string, back = ''): string {
  const sp = new URLSearchParams({ task: taskId, from: 'purchasing', supply: orderId });
  const tail = back.replace(/^\?/, '');
  if (tail) sp.set('back', tail);
  return `/warehouse?${sp.toString()}`;
}

/** Куда вернуться со склада в закупку: сохранённый запрос либо сам заказ */
export function purchasingReturnHref(back: string | null, supply: string | null): string {
  const tail = (back ?? '').replace(/^\?/, '');
  if (tail) return `/purchasing?${tail}`;
  return supply ? `/purchasing?${new URLSearchParams({ supply }).toString()}` : '/purchasing';
}

/**
 * Сколько осталось принять: потребность минус принятое.
 *
 * Знаменатель — `qty_expected` («нужно по заказу»): по нему сервер решает,
 * полная ли приёмка (`erp_material_fully_received`), и по нему закрывается
 * закупка. Заказанное поставщику (`qty_ordered`) — запасной знаменатель
 * строки без потребности. Перебор не уходит в минус: «осталось −10»
 * читалось бы как долг склада.
 *
 * `null` — сказать нечего: ни потребности, ни заказанного.
 */
export function qtyLeftToAccept(
  m: Pick<ErpMaterial, 'qty_expected' | 'qty_received'> & { qty_ordered?: number | null },
): number | null {
  const need = m.qty_expected ?? m.qty_ordered ?? null;
  if (need == null) return null;
  // Округление до тысячных: 10,2 − 3,1 в двоичной арифметике — не 7,1
  return Math.max(0, Math.round((Number(need) - Number(m.qty_received ?? 0)) * 1000) / 1000);
}
