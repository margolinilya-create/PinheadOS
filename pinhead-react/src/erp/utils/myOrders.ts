/**
 * «Мой заказ» глазами менеджера (правка заказчика, сессия 33).
 *
 * Связь заказа с человеком в ERP двойная, и обе половины нужны:
 *   · `created_by` — кто завёл заказ. Точная, но покрывает только созданные
 *     самим: заказ, заведённый РОПом на менеджера, сюда не попадёт;
 *   · `manager` — ТЕКСТ с именем ответственного. Он и приезжает из ТЗ
 *     (`data.managerName`), и правится в форме, и именно его видно в списке.
 *
 * Поэтому «моё» = одно ИЛИ другое. Одного `created_by` мало (чужие заказы
 * на моём имени пропали бы), одного имени — тоже: тёзки, переименования и
 * пустое поле у заказов, заведённых до появления колонки.
 *
 * Сравнение имён нечувствительно к регистру и краевым пробелам: поле свободное,
 * и «Иванов » с пробелом на конце — обычное дело при вставке из переписки.
 */

export interface OrderOwnerLike {
  created_by?: string | null;
  manager?: string | null;
}

export interface ActorLike {
  id?: string | null;
  name?: string | null;
}

export function isMyOrder(order: OrderOwnerLike, me: ActorLike): boolean {
  if (me.id && order.created_by && order.created_by === me.id) return true;
  const mine = (me.name ?? '').trim().toLowerCase();
  if (!mine) return false;
  return (order.manager ?? '').trim().toLowerCase() === mine;
}
