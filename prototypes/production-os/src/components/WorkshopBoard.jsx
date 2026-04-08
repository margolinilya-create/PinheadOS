import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore, { useWorkshopTasks } from '../store/useWorkshopStore';
import { WORKSHOP_MAP } from '../data/workshops';
import WorkshopSelector from './WorkshopSelector';
import TaskCard from './TaskCard';
import TaskDetail from './TaskDetail';
import NotificationBell from './NotificationBell';
import styles from './WorkshopBoard.module.css';

function SectionHeader({ title, count, icon }) {
  return (
    <div className={styles.sectionHeader}>
      {icon && <span className={styles.sectionIcon}>{icon}</span>}
      <span className={styles.sectionTitle}>{title}</span>
      <span className={styles.sectionCount}>{count}</span>
    </div>
  );
}

export default function WorkshopBoard() {
  const navigate = useNavigate();
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deadlineFilter, setDeadlineFilter] = useState('all');
  const [sortBy, setSortBy] = useState('deadline');
  const currentWorkshop = useWorkshopStore(s => s.currentWorkshop);
  const selectedTaskId = useWorkshopStore(s => s.selectedTaskId);
  const orders = useWorkshopStore(s => s.orders);
  const workshopTasks = useWorkshopTasks();

  const ws = WORKSHOP_MAP[currentWorkshop];
  const today = new Date().toISOString().split('T')[0];

  // Apply search + deadline filter to all tasks before splitting
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (6 - now.getDay()));

    return workshopTasks.filter(t => {
      // Search filter
      if (q) {
        const order = orders[t.order_id];
        const orderNum = (order?.order_number || '').toLowerCase();
        const clientName = (order?.data?.name || '').toLowerCase();
        if (!orderNum.includes(q) && !clientName.includes(q)) return false;
      }

      // Deadline filter (skip for done tasks — they stay outside filter scope)
      if (deadlineFilter !== 'all' && t.status !== 'done') {
        if (!t.due_date) return deadlineFilter === 'all';
        const due = new Date(t.due_date);
        due.setHours(0, 0, 0, 0);
        if (deadlineFilter === 'today') {
          if (due.getTime() !== now.getTime()) return false;
        } else if (deadlineFilter === 'overdue') {
          if (due >= now) return false;
        } else if (deadlineFilter === 'week') {
          if (due < now || due > endOfWeek) return false;
        }
      }

      return true;
    });
  }, [workshopTasks, orders, searchQuery, deadlineFilter]);

  const { inProgress, ready, blocked, doneToday, donePast } = useMemo(() => {
    const inProgress = filteredTasks.filter(t => t.status === 'in_progress');

    let readyList = filteredTasks.filter(t => t.status === 'ready');
    if (sortBy === 'deadline') {
      readyList = readyList.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
    } else if (sortBy === 'qty') {
      readyList = readyList.sort((a, b) => b.total_units - a.total_units);
    } else if (sortBy === 'status') {
      const ORDER = { in_progress: 0, ready: 1, blocked: 2, pending: 3 };
      readyList = readyList.sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));
    }

    const blocked = filteredTasks.filter(t => t.status === 'blocked');
    const doneToday = filteredTasks.filter(t => t.status === 'done' && t.completed_at && t.completed_at.startsWith(today));
    const donePast = filteredTasks.filter(t => t.status === 'done' && (!t.completed_at || !t.completed_at.startsWith(today)));
    return { inProgress, ready: readyList, blocked, doneToday, donePast };
  }, [filteredTasks, today, sortBy]);

  const allDone = [...doneToday, ...donePast];
  const activeCount = inProgress.length + ready.length + blocked.length;

  const dateStr = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  return (
    <div className={styles.root}>
      <WorkshopSelector />

      {/* Workshop header */}
      <div className={styles.hero} style={{ '--ws-accent': ws?.color || '#666' }}>
        <div className={styles.heroTop}>
          <h1 className={styles.heroTitle}>{ws?.name || currentWorkshop}</h1>
          <div className={styles.heroActions}>
            <NotificationBell />
            <button className={styles.directorLink} onClick={() => navigate('/director')}>Панель →</button>
            <span className={styles.heroDate}>{dateStr}</span>
          </div>
        </div>
        <div className={styles.heroStats}>
          <span className={`${styles.chip} ${styles.chipActive}`}>{activeCount} активных</span>
          {inProgress.length > 0 && <span className={`${styles.chip} ${styles.chipProgress}`}>{inProgress.length} в работе</span>}
          {blocked.length > 0 && <span className={`${styles.chip} ${styles.chipBlocked}`}>{blocked.length} заблок.</span>}
          {allDone.length > 0 && <span className={`${styles.chip} ${styles.chipDone}`}>{allDone.length} сделано</span>}
        </div>
      </div>

      <div className={styles.content}>
        {/* FILTER BAR */}
        <div className={styles.filterBar} role="search" aria-label="Фильтры и поиск задач">
          <input
            className={styles.filterSearch}
            type="text"
            placeholder="Поиск по номеру или клиенту..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Поиск по номеру заказа или клиенту"
          />
          <select
            className={styles.filterSelect}
            value={deadlineFilter}
            onChange={e => setDeadlineFilter(e.target.value)}
            aria-label="Фильтр по дедлайну"
          >
            <option value="all">Все</option>
            <option value="today">Сегодня</option>
            <option value="overdue">Просрочено</option>
            <option value="week">Эта неделя</option>
          </select>
          <select
            className={styles.filterSelect}
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            aria-label="Сортировка задач"
          >
            <option value="deadline">По дедлайну</option>
            <option value="qty">По количеству</option>
            <option value="status">По статусу</option>
          </select>
        </div>

        {/* Task list — announced to screen readers when content changes */}
        <div aria-live="polite" aria-label="Список задач цеха">

        {/* В РАБОТЕ */}
        {inProgress.length > 0 && (
          <div className={`${styles.section} ${styles.sectionInprogress}`}>
            <SectionHeader title="В работе" count={inProgress.length} icon="▶" />
            <div className={styles.cards}>
              {inProgress.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* BLOCKED */}
        {blocked.length > 0 && (
          <div className={`${styles.section} ${styles.sectionBlocked}`}>
            <SectionHeader title="Заблокировано" count={blocked.length} icon="⚠" />
            <div className={styles.cards}>
              {blocked.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* ГОТОВО К РАБОТЕ */}
        {ready.length > 0 && (
          <div className={styles.section}>
            <SectionHeader title="Готово к работе" count={ready.length} icon="●" />
            <div className={styles.cards}>
              {ready.map(t => <TaskCard key={t.id} task={t} />)}
            </div>
          </div>
        )}

        {/* Пусто */}
        {activeCount === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>✓</div>
            <div className={styles.emptyText}>Нет активных задач</div>
            <div className={styles.emptySub}>Все заказы для {ws?.name || 'цеха'} выполнены или ещё не поступили</div>
          </div>
        )}

        </div>{/* end aria-live */}

        {/* СДЕЛАНО */}
        {allDone.length > 0 && (
          <div className={`${styles.section} ${styles.sectionDone}`}>
            <button className={styles.sectionToggle} onClick={() => setDoneExpanded(v => !v)}>
              <SectionHeader title="Сделано" count={allDone.length} icon="✓" />
              <span className={styles.toggleArrow}>{doneExpanded ? '▲' : '▼'}</span>
            </button>
            <div className={`${styles.cardsCollapse} ${doneExpanded ? styles.cardsExpanded : styles.cardsCollapsed}`}>
              <div className={`${styles.cards} ${styles.cardsDone}`}>
                {allDone.map(t => <TaskCard key={t.id} task={t} />)}
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedTaskId && <TaskDetail />}
    </div>
  );
}
