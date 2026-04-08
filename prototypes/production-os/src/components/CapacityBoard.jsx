import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOPS } from '../data/workshops';
import { assessOrderRisk } from '../utils/risk';
import styles from './CapacityBoard.module.css';

// ── Date helpers ──────────────────────────────────────────────────────────────

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatWeekRange(monday) {
  const friday = addDays(monday, 4);
  const monthNames = [
    'января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря',
  ];
  const sameMonth = monday.getMonth() === friday.getMonth();
  const monStr = `${monday.getDate()}`;
  const friStr = `${friday.getDate()} ${monthNames[friday.getMonth()]}`;
  if (sameMonth) {
    return `Пн ${monStr} – Пт ${friStr}`;
  }
  return `Пн ${monStr} ${monthNames[monday.getMonth()]} – Пт ${friStr}`;
}

const SHORT_DAY = ['Пн','Вт','Ср','Чт','Пт'];

// ── Cell color by task count ──────────────────────────────────────────────────

function cellStyle(count) {
  if (count === 0) return { background: 'var(--bg3)', color: 'var(--text-dim)', opacity: 0.5 };
  if (count === 1) return { background: 'rgba(16,185,129,0.18)', color: '#059669' };
  if (count === 2) return { background: 'rgba(234,179,8,0.22)',  color: '#a16207' };
  if (count === 3) return { background: 'rgba(249,115,22,0.25)', color: '#c2410c' };
  return              { background: 'rgba(239,68,68,0.22)',  color: '#b91c1c' };
}

function cellLabel(count) {
  if (count === 0) return '—';
  if (count <= 2)  return '█';
  if (count <= 4)  return '██';
  return '███';
}

// ── HeatmapRow ────────────────────────────────────────────────────────────────

function HeatmapRow({ workshop, dayCounts, weekPct }) {
  let pctColor;
  if (weekPct >= 80) pctColor = 'var(--color-error)';
  else if (weekPct >= 50) pctColor = 'var(--color-warning)';
  else pctColor = 'var(--color-success)';

  return (
    <div className={styles.hmRow}>
      <div className={styles.hmWs}>
        <span className={styles.hmDot} style={{ background: workshop.color }} />
        <span className={styles.hmWsName}>{workshop.name}</span>
      </div>

      {dayCounts.map((count, i) => {
        const cs = cellStyle(count);
        return (
          <div
            key={i}
            className={styles.hmCell}
            style={{ background: cs.background }}
            title={`${workshop.name}: ${count} задач`}
          >
            <span style={{ color: cs.color }}>{cellLabel(count)}</span>
          </div>
        );
      })}

      <div className={styles.hmPct} style={{ color: pctColor }}>{weekPct}%</div>
    </div>
  );
}

// ── HeatmapPanel ──────────────────────────────────────────────────────────────

function HeatmapPanel({ monday, tasks }) {
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));

  const heatmap = useMemo(() => {
    const weekStart = monday;
    const weekEnd = addDays(monday, 4);

    return WORKSHOPS.map(ws => {
      const wsTasks = tasks.filter(
        t => t.workshop_code === ws.code && t.status !== 'done'
      );

      const dayCounts = weekDays.map(day => {
        return wsTasks.filter(t => {
          if (!t.due_date) return false;
          const due = new Date(t.due_date);
          return isSameDay(due, day);
        }).length;
      });

      const weekActive = wsTasks.filter(t => {
        if (!t.due_date) return false;
        const due = new Date(t.due_date);
        due.setHours(0,0,0,0);
        return due >= weekStart && due <= weekEnd;
      }).length;

      const CAPACITY_PER_WEEK = 25;
      const weekPct = Math.min(100, Math.round((weekActive / CAPACITY_PER_WEEK) * 100));

      return { workshop: ws, dayCounts, weekPct };
    });
  }, [monday, tasks]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Недельная загрузка</span>
      </div>

      <div className={styles.hmGrid}>
        {/* Header row */}
        <div className={`${styles.hmRow} ${styles.hmRowHead}`}>
          <div className={styles.hmWs} />
          {weekDays.map((d, i) => (
            <div key={i} className={`${styles.hmCell} ${styles.hmCellHead}`}>
              <span className={styles.hmDayShort}>{SHORT_DAY[i]}</span>
              <span className={styles.hmDayNum}>{d.getDate()}</span>
            </div>
          ))}
          <div className={styles.hmPctHead}>%</div>
        </div>

        {heatmap.map(({ workshop, dayCounts, weekPct }) => (
          <HeatmapRow
            key={workshop.code}
            workshop={workshop}
            dayCounts={dayCounts}
            weekPct={weekPct}
          />
        ))}

        {/* Legend */}
        <div className={styles.hmLegend}>
          <span className={styles.hmLegendItem} style={{ color: 'var(--text-dim)' }}>░ нет задач</span>
          <span className={styles.hmLegendItem} style={{ color: '#059669' }}>█ 1</span>
          <span className={styles.hmLegendItem} style={{ color: '#a16207' }}>██ 2</span>
          <span className={styles.hmLegendItem} style={{ color: '#c2410c' }}>██ 3</span>
          <span className={styles.hmLegendItem} style={{ color: '#b91c1c' }}>███ 4+</span>
        </div>
      </div>
    </div>
  );
}

// ── DeadlineForecastPanel ─────────────────────────────────────────────────────

function DeadlineForecastPanel({ tasks, orders }) {
  const monthNames = [
    'янв','фев','мар','апр','май','июн',
    'июл','авг','сен','окт','ноя','дек',
  ];

  const sortedOrders = useMemo(() => {
    return Object.values(orders)
      .filter(o => o.data?.deadline)
      .sort((a, b) => new Date(a.data.deadline) - new Date(b.data.deadline));
  }, [orders]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Прогноз дедлайнов</span>
        <span className={styles.panelCount}>{sortedOrders.length} заказов</span>
      </div>

      <div className={styles.dlList}>
        {sortedOrders.map(order => {
          const risk = assessOrderRisk(order, tasks);
          const d = new Date(order.data.deadline);
          const dateStr = `${d.getDate()} ${monthNames[d.getMonth()]}`;

          let riskIcon, riskColor;
          if (risk.type === 'risk') { riskIcon = '⚠'; riskColor = 'var(--color-error)'; }
          else if (risk.type === 'warn') { riskIcon = '⚠'; riskColor = 'var(--color-warning)'; }
          else { riskIcon = '✓'; riskColor = 'var(--color-success)'; }

          return (
            <div key={order.id} className={styles.dlRow}>
              <div className={styles.dlLeft}>
                <span className={styles.dlNum}>{order.order_number}</span>
                <span className={styles.dlClient}>{order.data?.name || '—'}</span>
              </div>
              <div className={styles.dlMid}>
                <span className={styles.dlQty}>{order.total_qty} шт</span>
                <span className={styles.dlDate}>Дедлайн: {dateStr}</span>
              </div>
              <div className={styles.dlRisk} style={{ color: riskColor }}>
                <span className={styles.dlRiskIcon}>{riskIcon}</span>
                <span className={styles.dlRiskMsg}>{risk.message}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CapacityBoard (root) ──────────────────────────────────────────────────────

export default function CapacityBoard() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);

  const [weekOffset, setWeekOffset] = useState(0);

  const monday = useMemo(() => {
    const base = getMondayOfWeek(new Date());
    return addDays(base, weekOffset * 7);
  }, [weekOffset]);

  const weekLabel = formatWeekRange(monday);

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerTitleWrap}>
            <h1 className={styles.headerTitle}>ПЛАНИРОВАНИЕ МОЩНОСТЕЙ</h1>
          </div>
        </div>

        <div className={styles.weekNav}>
          <button
            className={styles.navBtn}
            onClick={() => setWeekOffset(v => v - 1)}
            aria-label="Предыдущая неделя"
          >
            ←
          </button>
          <span className={styles.weekLabel}>{weekLabel}</span>
          <button
            className={styles.navBtn}
            onClick={() => setWeekOffset(v => v + 1)}
            aria-label="Следующая неделя"
          >
            →
          </button>
        </div>

        <div className={styles.headerNav}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            ← К цехам
          </button>
          <button className={styles.backBtn} onClick={() => navigate('/director')}>
            Панель
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <main className={styles.main}>
        <HeatmapPanel monday={monday} tasks={tasks} orders={orders} />
        <DeadlineForecastPanel tasks={tasks} orders={orders} />
      </main>
    </div>
  );
}
