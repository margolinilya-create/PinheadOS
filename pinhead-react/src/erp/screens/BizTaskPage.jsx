import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import { Badge } from '../components/Badge';
import { Icon } from '../components/Icon';
import { EmptyResult } from '../components/ErpStates';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import { BIZ_TASK_KIND_LABELS, BIZ_TASK_STATUS_LABELS } from '../utils/bizTasks';
import { formatDue } from '../../utils/date';
import { orderLabel } from './bizTasks/bizTaskView';
import styles from './bizTasks/BizTasksScreen.module.css';

/**
 * СТРАНИЦА ЗАДАЧИ `/biz-tasks/:taskId` — вход маршрута (правки 19.10, п. 7).
 *
 * Пока — шапка задачи и две ссылки: обратно к списку (адрес списка с его
 * фильтрами приезжает в `state.from` от строки `BizTaskList`; прямой заход —
 * общий раздел) и на заказ (`?tab=tasks`). Полная карточка с действиями,
 * чек-листом и диалогом — задача 7 плана (`bizTasks/BizTaskCard`), она
 * встаёт сюда же; маршрут и ключ по `taskId` остаются.
 */
export default function BizTaskPage() {
  const { taskId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const back = typeof state?.from === 'string' && state.from.startsWith('/') ? state.from : '/biz-tasks';
  const task = useErpStore((s) => s.bizTasks[taskId]);
  const loadBizTask = useErpStore((s) => s.loadBizTask);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    loadBizTask(taskId).then((d) => { if (alive) setStatus(d ? 'ready' : 'failed'); });
    return () => { alive = false; };
  }, [taskId, loadBizTask]);

  const backLink = (
    <Link to={back}><Icon name="arrowLeft" size={14} /> К задачам</Link>
  );
  if (!task && status === 'failed') {
    // Нет строки: задача не найдена, недоступна или сеть — причину уже назвал тост стора
    return (
      <EmptyResult icon="inbox" onReset={() => navigate(back)} resetLabel="К задачам">
        Не удалось открыть задачу.
      </EmptyResult>
    );
  }
  if (!task) return <ScreenSkeleton />;

  return (
    <div className={styles.screen}>
      {backLink}
      <PageHead title={task.title} sub={`${BIZ_TASK_KIND_LABELS[task.kind]} · ${formatDue(task.due_at)}`} />
      <div className={styles.bar}>
        <Badge>{BIZ_TASK_STATUS_LABELS[task.status]}</Badge>
        {task.order && (
          <Link to={`/orders/${task.order_id}?tab=tasks`}>Заказ {orderLabel(task.order)}</Link>
        )}
      </div>
    </div>
  );
}
