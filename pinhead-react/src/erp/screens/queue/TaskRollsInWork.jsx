import { useMemo } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { RollsInWork } from './RollsInWork';
import { useRollsInWork } from './useRollsInWork';

/**
 * «ЗАВЕРШИТЬ РУЛОН» НА ЭКРАНЕ ЗАДАНИЯ (обход QA 09.10). Отказ «Завершить
 * этап» называет рулон и велит его завершить, а кнопка жила только внутри
 * формы «Записать результат». Рулоны — из полного заказа стора: у строки
 * очереди их может не быть.
 */
export function TaskRollsInWork({ entry, disabled = false }) {
  const { order, item, stage } = entry;
  const fullOrder = useErpStore((s) => s.orders.find((o) => o.id === order.id)) ?? order;
  const fullItem = useMemo(
    () => (fullOrder.items ?? []).find((it) => it.id === item.id) ?? item,
    [fullOrder, item],
  );
  const finishRoll = useErpStore((s) => s.finishRoll);
  const { awaitingFate, inWork } = useRollsInWork({ order: fullOrder, item: fullItem, stage });
  return (
    <RollsInWork
      inWork={inWork}
      awaitingCount={awaitingFate.length}
      itemId={item.id}
      onFinishRoll={finishRoll}
      disabled={disabled}
    />
  );
}
