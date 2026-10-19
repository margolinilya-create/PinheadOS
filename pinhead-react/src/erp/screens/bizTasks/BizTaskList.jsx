import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { BIZ_TASK_KIND_LABELS, BIZ_TASK_STATUS_LABELS, isOverdue } from '../../utils/bizTasks';
import { formatDue } from '../../../utils/date';
import base from '../../styles';
import styles from './BizTaskList.module.css';

/** Цвет статуса — тот же язык чипов, что у этапов и заказов */
const STATUS_VARIANT = {
  new: 'info',
  in_progress: 'progress',
  paused: 'waiting',
  review: 'violet',
  done: 'done',
  cancelled: 'skipped',
};

/** `id` строки — по нему форма создания возвращает фокус на новую задачу */
const bizTaskRowId = (id) => `biz-task-row-${id}`;

/**
 * Список бизнес-задач — одна строка на задачу, общий для вкладки заказа
 * и общего раздела («одна и та же задача, без копий»).
 *
 * ВСЯ СТРОКА — ССЫЛКА на карточку задачи: так её доступное имя несёт
 * название, тип, ответственного, срок, статус, «Просрочена» и непрочитанное
 * разом (Global Constraints плана: бейдж просрочки входит в имя строки),
 * а клик по любому месту строки открывает задачу. Переход уносит адрес
 * списка в `state.from` — карточка вернёт туда вместе с фильтрами.
 *
 * Просрочка — иконка И текст: цвет без слова не читается ни читалкой,
 * ни человеком, не различающим красный.
 */
export function BizTaskList({
  tasks,
  /** `Map<user_id, имя>` — из справочника чата (`erp_chat_directory`) */
  names,
  /** Непрочитанные сообщения треда — по задаче */
  unread,
  now,
  /** Общий раздел: заказ и постановщик в строке */
  showOrder = false,
  /** Строка, на которую вернуть фокус (только что созданная задача) */
  focusId = null,
}) {
  const location = useLocation();
  const from = `${location.pathname}${location.search}`;

  /**
   * Фокус — ОДИН РАЗ на новый `focusId`, а не на каждую перерисовку: звонок
   * realtime перерисовывает список, и фокус, прыгающий на строку посреди
   * чужой работы, хуже отсутствующего.
   */
  useEffect(() => {
    if (!focusId) return;
    document.getElementById(bizTaskRowId(focusId))?.focus();
  }, [focusId]);

  return (
    <ul className={styles.list}>
      {tasks.map((t) => {
        const overdue = isOverdue(t, now);
        const count = unread?.[t.id] ?? 0;
        return (
          <li key={t.id}>
            <Link
              id={bizTaskRowId(t.id)}
              to={`/biz-tasks/${t.id}`}
              state={{ from }}
              className={styles.row}
            >
              {/* Пробелы между частями — для доступного имени: у строчных
                  элементов без них имя склеилось бы в «молнииЗакупка» */}
              <span className={styles.title}>{t.title}</span>{' '}
              <span className={styles.meta}>
                <span>{BIZ_TASK_KIND_LABELS[t.kind]}</span>{' '}
                <span className={styles.who}>
                  <Icon name="user" size={13} />
                  {names.get(t.assignee_id) ?? '—'}
                </span>{' '}
                <span className={styles.due}>
                  <Icon name="clock" size={13} />
                  {formatDue(t.due_at)}
                </span>{' '}
                {showOrder && t.order && (
                  <span>{t.order.bitrix_id ? `№${t.order.bitrix_id} · ` : ''}{t.order.title}</span>
                )}{' '}
                {showOrder && (
                  <span className={styles.who}>Поставил: {names.get(t.creator_id) ?? '—'}</span>
                )}
              </span>{' '}
              <span className={styles.state}>
                <Badge variant={STATUS_VARIANT[t.status]}>{BIZ_TASK_STATUS_LABELS[t.status]}</Badge>{' '}
                {overdue && (
                  <Badge variant="danger" className={styles.overdue}>
                    <Icon name="alert" size={13} />
                    Просрочена
                  </Badge>
                )}{' '}
                {count > 0 && (
                  <span className={styles.unread}>
                    <Icon name="comment" size={13} />
                    <span className={base.visuallyHidden}>Непрочитанных сообщений:</span>{' '}
                    {count}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
