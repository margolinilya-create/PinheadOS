import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { WORKSHOPS } from '../data/workshops';
import OrderTimeline from './OrderTimeline';
import { getDeadlineInfo } from './TaskCard';
import { assessOrderRisk } from '../utils/risk';
import styles from './DirectorView.module.css';

// ─── WorkshopLoadPanel ────────────────────────────────────────────────────────

function WorkshopLoadPanel({ stats }) {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Загрузка цехов</span>
        <span className={styles.panelCount}>{WORKSHOPS.length} цехов</span>
      </div>
      <div className={styles.loadList}>
        {WORKSHOPS.map(ws => {
          const s = stats[ws.code] || { active: 0, total: 0 };
          const pct = s.total === 0 ? 0 : Math.round((s.active / s.total) * 100);
          let barColor;
          if (pct >= 80) barColor = 'var(--color-error)';
          else if (pct >= 50) barColor = 'var(--color-warning)';
          else barColor = 'var(--color-success)';

          let pctColor;
          if (pct >= 80) pctColor = 'var(--color-error)';
          else if (pct >= 50) pctColor = 'var(--color-warning)';
          else pctColor = 'var(--color-success)';

          return (
            <div key={ws.code} className={styles.loadRow}>
              <div className={styles.loadLabel}>
                <span className={styles.loadIcon}>{ws.icon}</span>
                <span className={styles.loadName}>{ws.name}</span>
              </div>
              <div className={styles.loadBarWrap}>
                <div
                  className={styles.loadBarFill}
                  style={{
                    width: `${pct}%`,
                    background: barColor,
                  }}
                />
              </div>
              <div className={styles.loadMeta}>
                <span className={styles.loadCounts}>{s.active}/{s.total}</span>
                <span className={styles.loadPct} style={{ color: pctColor }}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BottleneckPanel ──────────────────────────────────────────────────────────

function BottleneckPanel({ bottlenecks }) {
  const hasIssues = bottlenecks.length > 0;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Узкие места</span>
        {hasIssues && (
          <span className={`${styles.panelBadge} ${styles.panelBadgeWarn}`}>{bottlenecks.length}</span>
        )}
      </div>

      {!hasIssues ? (
        <div className={styles.bnOk}>
          <span className={styles.bnOkIcon}>✅</span>
          <span className={styles.bnOkText}>Всё в порядке</span>
        </div>
      ) : (
        <div className={styles.bnList}>
          {bottlenecks.map((item, idx) => (
            <div
              key={idx}
              className={`${styles.bnItem}${item.severity === 'blocked' ? ' ' + styles.bnItemBlocked : ' ' + styles.bnItemWaiting}`}
            >
              <span className={styles.bnIcon}>{item.severity === 'blocked' ? '🔴' : '⚠️'}</span>
              <div className={styles.bnBody}>
                <span className={styles.bnWs}>{item.workshopName}</span>
                <span className={styles.bnMsg}>{item.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OrderPipelinePanel ───────────────────────────────────────────────────────

function OrderPipelinePanel({ sortedOrders, orders, tasks }) {
  const [highlightId, setHighlightId] = useState(null);

  return (
    <div className={`${styles.panel} ${styles.panelFull}`}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Заказы в производстве</span>
        <span className={styles.panelCount}>{sortedOrders.length} заказов</span>
      </div>

      <div className={styles.pipelineList}>
        {sortedOrders.length === 0 && (
          <div style={{ textAlign: 'center', padding: 'var(--space-3xl) var(--space-xl)', color: 'var(--text-dim)', fontSize: 'var(--type-body)' }}>
            Нет заказов в производстве
          </div>
        )}
        {sortedOrders.map(orderId => {
          const order = orders[orderId];
          if (!order) return null;
          const deadline = getDeadlineInfo(order.data?.deadline);
          const risk = assessOrderRisk(order, tasks);
          const isHighlighted = highlightId === orderId;

          return (
            <div
              key={orderId}
              className={`${styles.pipeRow}${isHighlighted ? ' ' + styles.pipeRowActive : ''}${risk?.level === 'critical' ? ' ' + styles.pipeRowRisk : ''}`}
              onClick={() => setHighlightId(v => v === orderId ? null : orderId)}
            >
              <div className={styles.pipeLeft}>
                <span className={styles.pipeNum}>{order.order_number}</span>
                {deadline && (
                  <span className={styles.pipeDeadline} style={{ color: deadline.color }}>
                    {deadline.label}
                  </span>
                )}
              </div>

              <div className={styles.pipeCenter}>
                <span className={styles.pipeClient}>{order.data?.name || '—'}</span>
                <span className={styles.pipeQty}>{order.total_qty} шт</span>
              </div>

              <div className={styles.pipeRight}>
                <OrderTimeline orderId={orderId} compact />
              </div>

              <div className={styles.pipeRisk}>
                {risk && (
                  <span className={styles.riskBadge} style={{ color: risk.color }}>
                    {risk.level === 'critical' ? '⚠ ' : risk.level === 'warning' ? '⏳ ' : '✓ '}
                    {risk.label}
                  </span>
                )}
              </div>

              <div className={styles.pipeDate}>
                {order.data?.deadline
                  ? new Date(order.data.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                  : '—'
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DirectorView (root) ──────────────────────────────────────────────────────

export default function DirectorView() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);

  const dateStr = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // ── Workshop load stats ──────────────────────────────────────────────────────
  const workshopStats = useMemo(() => {
    const stats = {};
    for (const ws of WORKSHOPS) {
      const wsTasks = tasks.filter(t => t.workshop_code === ws.code);
      const nonDone = wsTasks.filter(t => t.status !== 'done' && t.status !== 'pending');
      const active = nonDone.filter(t =>
        t.status === 'ready' || t.status === 'in_progress' || t.status === 'blocked'
      );
      // total = all tasks for this workshop that are actionable (not pending/done)
      const total = wsTasks.filter(t => t.status !== 'pending' && t.status !== 'done');
      stats[ws.code] = {
        active: active.length,
        total: total.length,
      };
    }
    return stats;
  }, [tasks]);

  // ── Bottlenecks ──────────────────────────────────────────────────────────────
  const bottlenecks = useMemo(() => {
    const items = [];
    const now = new Date();

    for (const ws of WORKSHOPS) {
      const wsName = ws.name;

      // Blocked tasks
      const blocked = tasks.filter(
        t => t.workshop_code === ws.code && t.status === 'blocked'
      );
      if (blocked.length > 0) {
        items.push({
          severity: 'blocked',
          workshopName: wsName,
          message: `${blocked.length} ${blocked.length === 1 ? 'задача заблокирована' : blocked.length < 5 ? 'задачи заблокированы' : 'задач заблокированы'}`,
          sortKey: 0,
        });
      }

      // Ready tasks waiting without started_at and with approaching deadline
      const waitingReady = tasks.filter(t => {
        if (t.workshop_code !== ws.code) return false;
        if (t.status !== 'ready') return false;
        if (t.started_at) return false;
        // Check if due_date is within 2 days or already past
        if (!t.due_date) return false;
        const due = new Date(t.due_date);
        due.setHours(23, 59, 59, 0);
        const diffHours = (due - now) / 3600000;
        return diffHours <= 48;
      });
      if (waitingReady.length > 0) {
        items.push({
          severity: 'waiting',
          workshopName: wsName,
          message: `${waitingReady.length} ${waitingReady.length === 1 ? 'задача ждёт' : waitingReady.length < 5 ? 'задачи ждут' : 'задач ждут'} >24ч`,
          sortKey: 1,
        });
      }
    }

    // Sort: blocked first, then waiting
    return items.sort((a, b) => a.sortKey - b.sortKey);
  }, [tasks]);

  // ── Orders sorted by deadline urgency ────────────────────────────────────────
  const sortedOrderIds = useMemo(() => {
    return Object.keys(orders).sort((a, b) => {
      const da = orders[a]?.data?.deadline;
      const db = orders[b]?.data?.deadline;
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return new Date(da) - new Date(db);
    });
  }, [orders]);

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerTitleWrap}>
            <h1 className={styles.headerTitle}>ПРОИЗВОДСТВО</h1>
            <span className={styles.headerSub}>Центр управления</span>
          </div>
          <div className={styles.headerKpis}>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{tasks.filter(t => t.status === 'done').length}</span>
              <span className={styles.kpiLabel}>завершено</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{tasks.filter(t => t.status === 'in_progress').length}</span>
              <span className={styles.kpiLabel}>в работе</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{tasks.filter(t => t.status === 'blocked').length}</span>
              <span className={styles.kpiLabel}>заблок.</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiValue}>{Object.keys(orders).length}</span>
              <span className={styles.kpiLabel}>заказов</span>
            </div>
          </div>
          <span className={styles.headerDate}>{dateStr}</span>
        </div>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          <span className={styles.backArrow}>←</span> К цехам
        </button>
      </header>

      {/* ── Dashboard Grid ── */}
      <main className={styles.main}>
        {/* Top row: 2-column grid */}
        <div className={styles.topRow}>
          <WorkshopLoadPanel stats={workshopStats} />
          <BottleneckPanel bottlenecks={bottlenecks} />
        </div>

        {/* Bottom: full-width pipeline */}
        <OrderPipelinePanel sortedOrders={sortedOrderIds} orders={orders} tasks={tasks} />
      </main>
    </div>
  );
}
