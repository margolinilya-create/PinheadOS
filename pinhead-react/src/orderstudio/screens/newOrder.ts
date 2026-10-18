/**
 * «Новый заказ» — из меню и из списка заказов.
 *
 * Свой пустой черновик (без позиций и клиента) открывается вместо второго:
 * открытие ничего не пишет, новая строка в базе появляется, только если
 * пустого нет (решение контроллера, веха 3). Упал поиск — не создаём ничего:
 * иначе сбой сети плодил бы пустышки.
 *
 * Повторное нажатие, пока первое не закончилось (кнопка в меню и в списке —
 * две кнопки), получает тот же ответ, а не второй заказ.
 */
import { findOwnEmptyDraft } from '../api/salesOrders';
import { useSalesStore } from '../store/useSalesStore';

let pending: Promise<string | null> | null = null;

async function run(uid: string | null | undefined, managerName: string): Promise<string | null> {
  if (uid) {
    const found = await findOwnEmptyDraft(uid);
    if (!found.ok) return null;
    if (found.id) return found.id;
  }
  // Менеджер заказа — автор: имя из его профиля, на рабочем месте только для чтения.
  // Автор (`created_by`) — сразу, как его поставит сервер (`auth.uid()`): иначе гейты
  // «свой заказ» до перечитывания прячут от автора оплату и «Отправить в работу» (обход, W1)
  return useSalesStore.getState().createNew({
    ...(managerName ? { manager: managerName } : {}),
    ...(uid ? { created_by: uid } : {}),
  });
}

/** id заказа, который открыть; `null` — не вышло (тост уже показан) */
export function startNewOrder(uid: string | null | undefined, managerName = ''): Promise<string | null> {
  if (!pending) pending = run(uid, managerName.trim()).finally(() => { pending = null; });
  return pending;
}

/** Рабочее место нового заказа открывается на вкладке «Изделие» */
export const newOrderPath = (id: string): string => `/sales/${id}?tab=item`;
