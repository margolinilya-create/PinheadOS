import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useErpStore } from '../store/useErpStore';
import { Icon } from '../components/Icon';
import { EmptyResult } from '../components/ErpStates';
import { ScreenSkeleton } from '../components/ErpSkeletons';
import { BizTaskCard } from './bizTasks/BizTaskCard';
import styles from './bizTasks/BizTasksScreen.module.css';

/**
 * СТРАНИЦА ЗАДАЧИ `/biz-tasks/:taskId` — вход маршрута (правки 19.10, п. 7).
 *
 * Загрузка строки и частей карточки, ссылка обратно к списку (адрес списка
 * с его фильтрами приезжает в `state.from` от строки `BizTaskList`; прямой
 * заход — общий раздел) и сама карточка (`bizTasks/BizTaskCard`: ссылка
 * на заказ, действия, чек-лист, история, файлы и диалог).
 */
export default function BizTaskPage() {
  const { taskId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const back = typeof state?.from === 'string' && state.from.startsWith('/') ? state.from : '/biz-tasks';
  const task = useErpStore((s) => s.bizTasks[taskId]);
  const loadBizTask = useErpStore((s) => s.loadBizTask);
  /** Звонок realtime по задачам: чужое действие (статус, срок, файл) перечитывает карточку */
  const ping = useErpStore((s) => s.bizTaskPing);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let alive = true;
    loadBizTask(taskId).then((d) => { if (alive) setStatus(d ? 'ready' : 'failed'); });
    return () => { alive = false; };
  }, [taskId, loadBizTask, ping]);

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
      <BizTaskCard taskId={taskId} />
    </div>
  );
}
