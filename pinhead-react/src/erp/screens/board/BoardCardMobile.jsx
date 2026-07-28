import { Link } from 'react-router-dom';
import { formatDateShort, daysLeft } from '../../utils/time';
import { itemProgress } from '../../utils/progress';
import { isOrderReadyToShip } from '../../utils/stageUi';
import { orderLinkClick } from '../../store/useOrderDrawer';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';

/**
 * Позиция производственного плана карточкой — мобильный вид (<760px).
 *
 * Таблица плана на 390px показывала только «№ / Заказ / Кол-во»: срок, прогресс
 * и этапы уезжали за правый край без подсказки горизонтальной прокрутки, то есть
 * ровно то, ради чего этот экран и открывают. У списка заказов мобильное
 * представление было (`OrderCardMobile`), у плана — нет.
 *
 * Чипы этапов здесь только показывают состояние: менять статус тычком пальца
 * по 25-пиксельной пилюле в списке из сотни позиций — не сценарий. Для действий
 * есть очередь цеха и страница задания.
 */
export function BoardCardMobile({ order, item, renderStage }) {
  const d = daysLeft(order.due_date);
  const dueCls = d !== null && d < 0
    ? styles.overdue
    : d !== null && d <= 3 ? styles.dueSoon : undefined;
  const progress = itemProgress(item);

  return (
    <article className={styles.orderCardM} aria-label={`${order.title}: ${item.product_type}`}>
      <div className={styles.orderCardMHead}>
        <Link
          to={`/orders/${order.id}`}
          onClick={(e) => orderLinkClick(order.id, e)}
          className={styles.orderCardMTitle}
          title={`№${order.bitrix_id || '—'} · ${order.title}`}
        >
          №{order.bitrix_id || '—'} · {order.title} ↗
        </Link>
      </div>

      <div className={styles.subText} title={`${item.product_type}${item.variant ? ` · ${item.variant}` : ''}`}>
        {item.product_type}
        {item.variant ? ` · ${item.variant}` : ''} · {item.qty} шт
        {order.manager ? ` · ${order.manager}` : ''}
      </div>

      <div className={styles.orderCardMMeta}>
        <span className={dueCls}>
          {order.due_date ? formatDateShort(order.due_date) : 'без срока'}
          {d !== null && (d >= 0 ? ` · ${d} дн.` : ` · просрочен ${-d}`)}
        </span>
        {isOrderReadyToShip(order) && (
          <span className={`${styles.chip} ${styles.chipReady}`}>
            <Icon name="checkCircle" size={13} /> к отгрузке
          </span>
        )}
        <span
          className={styles.progressCell}
          aria-label={`Готовность ${progress.pct}%: ${progress.done} из ${progress.total} шт по этапам маршрута`}
        >
          {progress.pct}%
        </span>
      </div>

      <div className={styles.orderCardMItem}>
        {item.stages.map((st) => renderStage(st))}
      </div>
    </article>
  );
}
