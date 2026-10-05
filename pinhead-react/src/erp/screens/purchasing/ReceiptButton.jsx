import { useLocation } from 'react-router-dom';
import { Button, ButtonLink } from '../../components/Button';
import { materialReceiptTask, receiptAction, receiptHref } from '../../utils/receiptLink';
import styles from '../../styles';

/**
 * ПЕРЕХОД ОТ ПОЗИЦИИ ЗАКУПКИ К ЕЁ ПРИЁМКЕ (правка 05.10, п. 7).
 *
 * «Для ожидаемой поставки „Принять поставку", для принятой „Открыть
 * приёмку". Заказ, материал, поставка уже выбраны… Если приёмка уже есть —
 * открывать её, а не создавать ещё одну». Кнопка ведёт на склад сразу
 * в форму ЗАДАЧИ ЭТОЙ ПОЗИЦИИ: заказ, материал, поставщик, единица
 * и параметры ткани форма приёмки читает из той же строки `erp_materials`,
 * так что подставлять их второй раз некуда и незачем.
 *
 * С собой уезжает строка запроса закупки (`back`): возврат со склада
 * ведёт «в ту же закупку, с теми же фильтрами».
 *
 * Задачи ещё нет — кнопка погашена и говорит почему, а не пропадает:
 * пропавшая кнопка читается как поломка.
 */
export function ReceiptButton({ order, m, block = false }) {
  const { search } = useLocation();
  const task = materialReceiptTask(order, m.id);
  const action = receiptAction(m, task);
  if (!action) return null;
  if (action.disabled) {
    return (
      <span className={styles.receiptAction}>
        <Button variant="secondary" block={block} disabled title={action.hint}>
          {action.label}
        </Button>
        <span className={styles.subText}>{action.hint}</span>
      </span>
    );
  }
  return (
    <ButtonLink
      to={receiptHref(task.id, order.id, search)}
      variant={task.status === 'accepted' ? 'ghost' : 'primary'}
      block={block}
      aria-label={`${action.label}: ${m.name}`}
    >
      {action.label}
    </ButtonLink>
  );
}
