import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOPS } from '../data/workshops';
import { TYPE_NAMES } from '../data/labels';
import Clock from './Clock';
import styles from './AndonBoard.module.css';

function formatElapsed(startedAt) {
  if (!startedAt) return null;
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}м`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}ч ${mins}м` : `${hours}ч`;
}

function formatDate(date) {
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function StatusBadge({ task }) {
  const { status, started_at } = task;
  if (status === 'in_progress') {
    const elapsed = formatElapsed(started_at);
    return (
      <span className={`${styles.badge} ${styles.badgeInProgress}`}>
        ▶ {elapsed ? elapsed : 'В работе'}
      </span>
    );
  }
  if (status === 'ready') {
    return <span className={`${styles.badge} ${styles.badgeReady}`}>● ГОТОВО К РАБОТЕ</span>;
  }
  if (status === 'blocked') {
    return <span className={`${styles.badge} ${styles.badgeBlocked}`}>⚠ ЗАБЛОКИРОВАНО</span>;
  }
  return null;
}

function AndonTaskCard({ task, orders }) {
  const order = orders[task.order_id];
  if (!order) return null;
  const item = order.data?.items?.[0];
  const typeName = TYPE_NAMES[item?.type] || item?.type || '—';
  const isBlocked = task.status === 'blocked';

  return (
    <div className={`${styles.task}${isBlocked ? ' ' + styles.taskBlocked : ''}`}>
      <div className={styles.orderNum}>{order.order_number}</div>
      <div className={styles.garment}>{typeName}</div>
      <div className={styles.qty}>{task.total_units} шт</div>
      <StatusBadge task={task} />
      {isBlocked && task.problem_note && (
        <div className={styles.problemNote}>{task.problem_note}</div>
      )}
    </div>
  );
}

function WorkshopColumn({ workshop, tasks, orders }) {
  const activeTasks = tasks.filter(
    t => t.workshop_code === workshop.code && t.status !== 'done' && t.status !== 'pending'
  );

  const inProgressCount = activeTasks.filter(t => t.status === 'in_progress').length;
  const readyCount = activeTasks.filter(t => t.status === 'ready').length;
  const blockedCount = activeTasks.filter(t => t.status === 'blocked').length;

  return (
    <div className={styles.column} style={{ '--ws-color': workshop.color }}>
      <div className={styles.colHeader}>
        <span className={styles.colName}>{workshop.name}</span>
        <div className={styles.colCounts}>
          {inProgressCount > 0 && <span className={`${styles.count} ${styles.countProgress}`}>▶ {inProgressCount}</span>}
          {readyCount > 0 && <span className={`${styles.count} ${styles.countReady}`}>● {readyCount}</span>}
          {blockedCount > 0 && <span className={`${styles.count} ${styles.countBlocked}`}>⚠ {blockedCount}</span>}
          {activeTasks.length === 0 && <span className={`${styles.count} ${styles.countIdle}`}>— простой</span>}
        </div>
      </div>
      <div className={styles.colTasks}>
        {activeTasks.length === 0 ? (
          <div className={styles.empty}>Нет активных задач</div>
        ) : (
          activeTasks.map(task => (
            <AndonTaskCard key={task.id} task={task} orders={orders} />
          ))
        )}
      </div>
    </div>
  );
}

export default function AndonBoard() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);

  const [, forceRefresh] = useState(0);

  useEffect(() => {
    const refreshTimer = setInterval(() => forceRefresh(n => n + 1), 30000);
    return () => clearInterval(refreshTimer);
  }, []);

  const handleEsc = useCallback((e) => {
    if (e.key === 'Escape') navigate('/');
  }, [navigate]);

  useEffect(() => {
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'pending');
  const totalActive = activeTasks.length;
  const inProgressCount = activeTasks.filter(t => t.status === 'in_progress').length;
  const readyCount = activeTasks.filter(t => t.status === 'ready').length;
  const blockedCount = activeTasks.filter(t => t.status === 'blocked').length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  return (
    <div className={styles.root} onClick={() => navigate('/')}>
      <div className={styles.topbar} onClick={e => e.stopPropagation()}>
        <div className={styles.brand}>Pinhead Production</div>
        <div className={styles.clockWrap}>
          <Clock showDate formatDateFn={formatDate} className={styles.clock} dateClassName={styles.date} />
        </div>
      </div>

      <div className={styles.body} onClick={e => e.stopPropagation()}>
        <div className={styles.columns}>
          {WORKSHOPS.map(ws => (
            <WorkshopColumn
              key={ws.code}
              workshop={ws}
              tasks={tasks}
              orders={orders}
            />
          ))}
        </div>

        <div className={styles.sidebar}>
          <div className={styles.stats}>
            <div className={styles.statsTitle}>Итого</div>
            <div className={styles.statRow}>
              <span className={styles.statIcon}>◈</span>
              <span className={styles.statLabel}>Активных задач</span>
              <span className={`${styles.statValue} ${styles.statValueTotal}`}>{totalActive}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statIcon}>▶</span>
              <span className={styles.statLabel}>В работе</span>
              <span className={`${styles.statValue} ${styles.statValueProgress}`}>{inProgressCount}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statIcon}>●</span>
              <span className={styles.statLabel}>Готово к работе</span>
              <span className={`${styles.statValue} ${styles.statValueReady}`}>{readyCount}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statIcon}>⚠</span>
              <span className={styles.statLabel}>Заблокировано</span>
              <span className={`${styles.statValue} ${styles.statValueBlocked}`}>{blockedCount}</span>
            </div>
            <div className={styles.statRow}>
              <span className={styles.statIcon}>✓</span>
              <span className={styles.statLabel}>Завершено</span>
              <span className={`${styles.statValue} ${styles.statValueDone}`}>{doneCount}</span>
            </div>
          </div>
          <div className={styles.hint}>ESC или клик — вернуться</div>
        </div>
      </div>
    </div>
  );
}
