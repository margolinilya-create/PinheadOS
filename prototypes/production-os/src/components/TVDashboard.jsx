import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOPS } from '../data/workshops';
import Clock from './Clock';
import styles from './TVDashboard.module.css';

function formatDate(date) {
  const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
}

function formatEventTime(isoString) {
  const d = new Date(isoString);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const NOTIF_ICONS = {
  started:  '▶',
  blocked:  '⚠',
  handoff:  '→',
  complete: '✓',
};

const NOTIF_COLORS = {
  started:  '#4ADE80',
  blocked:  '#F87171',
  handoff:  '#60A5FA',
  complete: '#A78BFA',
};

function KpiCard({ label, value, color, sub }) {
  return (
    <div className={styles.kpiCard} style={{ '--kpi-color': color }}>
      <div className={styles.kpiValue}>{value}</div>
      <div className={styles.kpiLabel}>{label}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}

function WorkshopBar({ workshop, tasks }) {
  const wsTasks = tasks.filter(t => t.workshop_code === workshop.code);
  const active = wsTasks.filter(t => ['ready', 'in_progress', 'blocked'].includes(t.status)).length;
  const total = wsTasks.filter(t => t.status !== 'pending').length;
  const inProgress = wsTasks.filter(t => t.status === 'in_progress').length;
  const blocked = wsTasks.filter(t => t.status === 'blocked').length;
  const done = wsTasks.filter(t => t.status === 'done').length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  let barColor = workshop.color;
  if (blocked > 0) barColor = '#F87171';
  else if (inProgress > 0) barColor = '#4ADE80';

  void active;

  return (
    <div className={styles.wsRow}>
      <div className={styles.wsName} style={{ color: workshop.color }}>
        {workshop.name}
      </div>
      <div className={styles.wsBarWrap}>
        <div
          className={styles.wsBarFill}
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <div className={styles.wsMeta}>
        {blocked > 0 && <span className={`${styles.wsBadge} ${styles.wsBadgeBlocked}`}>⚠ {blocked}</span>}
        {inProgress > 0 && <span className={`${styles.wsBadge} ${styles.wsBadgeProgress}`}>▶ {inProgress}</span>}
        <span className={styles.wsPct}>{pct}%</span>
      </div>
    </div>
  );
}

export default function TVDashboard() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);
  const notifications = useWorkshopStore(s => s.notifications);

  void orders;

  const [, forceRefresh] = useState(0);
  const tickerRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    const refreshTimer = setInterval(() => forceRefresh(n => n + 1), 10000);
    return () => clearInterval(refreshTimer);
  }, []);

  // Auto-scroll ticker
  useEffect(() => {
    const el = tickerRef.current;
    if (!el) return;
    let lastTime = null;
    let pos = 0;

    function step(time) {
      if (!lastTime) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;
      pos += delta * 0.04; // px per ms
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) { pos = 0; }
      else if (pos >= maxScroll) { pos = 0; }
      el.scrollTop = pos;
      animFrameRef.current = requestAnimationFrame(step);
    }

    animFrameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [notifications.length]);

  const handleEsc = useCallback((e) => {
    if (e.key === 'Escape') navigate('/');
  }, [navigate]);

  useEffect(() => {
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [handleEsc]);

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'pending');
  const inProgressCount = activeTasks.filter(t => t.status === 'in_progress').length;
  const blockedCount = activeTasks.filter(t => t.status === 'blocked').length;

  // "Completed today" — tasks with completed_at today
  const todayStr = new Date().toISOString().slice(0, 10);
  const completedToday = tasks.filter(t => t.completed_at && t.completed_at.startsWith(todayStr)).length;

  const recentNotifs = notifications.slice(0, 10);

  // Total orders in production
  const activeOrderIds = new Set(activeTasks.map(t => t.order_id));
  const ordersInProgress = activeOrderIds.size;

  return (
    <div className={styles.root} onClick={() => navigate('/')}>
      <div className={styles.topbar} onClick={e => e.stopPropagation()}>
        <div className={styles.brand}>Pinhead Production</div>
        <div className={styles.clockWrap}>
          <Clock showDate formatDateFn={formatDate} className={styles.clock} dateClassName={styles.date} />
        </div>
      </div>

      <div className={styles.body} onClick={e => e.stopPropagation()}>
        <div className={styles.kpiRow}>
          <KpiCard
            label="Заказов в работе"
            value={ordersInProgress}
            color="#60A5FA"
          />
          <KpiCard
            label="Завершено сегодня"
            value={completedToday}
            color="#A78BFA"
          />
          <KpiCard
            label="Задач в работе"
            value={inProgressCount}
            color="#4ADE80"
          />
          <KpiCard
            label="Заблокировано"
            value={blockedCount}
            color={blockedCount > 0 ? '#F87171' : 'rgba(255,255,255,0.25)'}
          />
        </div>

        <div className={styles.mid}>
          <div className={styles.workshops}>
            <div className={styles.sectionTitle}>Загрузка цехов</div>
            <div className={styles.wsList}>
              {WORKSHOPS.map(ws => (
                <WorkshopBar key={ws.code} workshop={ws} tasks={tasks} />
              ))}
            </div>
          </div>

          <div className={styles.events}>
            <div className={styles.sectionTitle}>Последние события</div>
            <div className={styles.ticker} ref={tickerRef}>
              {recentNotifs.length === 0 ? (
                <div className={styles.noEvents}>Нет событий</div>
              ) : (
                recentNotifs.map(n => {
                  const color = NOTIF_COLORS[n.type] || 'rgba(255,255,255,0.4)';
                  const icon = NOTIF_ICONS[n.type] || '·';
                  return (
                    <div
                      key={n.id}
                      className={styles.eventItem}
                      style={{ '--ev-color': color }}
                    >
                      <span className={styles.eventIcon}>{icon}</span>
                      <div className={styles.eventContent}>
                        <div className={styles.eventTitle}>{n.title}</div>
                        <div className={styles.eventBody}>{n.body}</div>
                      </div>
                      <span className={styles.eventTime}>{formatEventTime(n.time)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.hint}>ESC или клик — вернуться</div>
    </div>
  );
}
