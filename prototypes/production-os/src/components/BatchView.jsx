import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import useWorkshopStore from '../store/useWorkshopStore';
import { MS_PER_DAY } from '../utils/format';
import styles from './BatchView.module.css';

const COLOR_NAMES = {
  white: 'Белый',
  black: 'Чёрный',
  navy: 'Тёмно-синий',
  grey: 'Серый',
  red: 'Красный',
  yellow: 'Жёлтый',
};

const TECH_LABELS = {
  screen: 'Шелкография',
  dtf: 'DTF',
};

// Batch setup time savings (mock): each shared run saves 2h for screen, 1.5h for DTF
const SAVINGS_PER_BATCH = {
  screen: 2,
  dtf: 1.5,
};

function formatSavings(tech, count) {
  const base = SAVINGS_PER_BATCH[tech] || 1;
  const saved = Math.round(base * (count - 1) * 10) / 10;
  if (saved === 0) return null;
  const h = Math.floor(saved);
  const m = Math.round((saved - h) * 60);
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}м`;
}

export default function BatchView() {
  const navigate = useNavigate();
  const tasks = useWorkshopStore(s => s.tasks);
  const orders = useWorkshopStore(s => s.orders);

  const batches = useMemo(() => {
    const batchableTechs = ['screen', 'dtf'];

    const candidateTasks = tasks.filter(t =>
      batchableTechs.includes(t.workshop_code) &&
      (t.status === 'ready' || t.status === 'pending')
    );

    const groups = {};
    for (const task of candidateTasks) {
      const order = orders[task.order_id];
      if (!order) continue;
      const item = order.data?.items?.[0];
      if (!item) continue;

      const color = item.color || 'unknown';
      const key = `${task.workshop_code}::${color}`;

      if (!groups[key]) {
        groups[key] = {
          tech: task.workshop_code,
          color,
          colorName: COLOR_NAMES[color] || color,
          techName: TECH_LABELS[task.workshop_code] || task.workshop_code,
          items: [],
        };
      }

      groups[key].items.push({
        taskId: task.id,
        orderId: task.order_id,
        orderNumber: order.order_number,
        clientName: order.data?.name || '—',
        qty: task.total_units,
        status: task.status,
        deadline: order.data?.deadline,
      });
    }

    return Object.values(groups)
      .filter(g => g.items.length >= 2)
      .sort((a, b) => b.items.length - a.items.length);
  }, [tasks, orders]);

  const totalPotentialSavings = useMemo(() => {
    let totalH = 0;
    for (const b of batches) {
      const base = SAVINGS_PER_BATCH[b.tech] || 1;
      totalH += base * (b.items.length - 1);
    }
    const h = Math.floor(totalH);
    const m = Math.round((totalH - h) * 60);
    if (h === 0 && m === 0) return null;
    if (h === 0) return `${m}м`;
    if (m === 0) return `${h}ч`;
    return `${h}ч ${m}м`;
  }, [batches]);

  function getStatusDot(status) {
    if (status === 'ready') return { color: '#22c55e', label: 'Готово к запуску' };
    if (status === 'pending') return { color: '#f59e0b', label: 'Ожидает' };
    return { color: '#9ca3af', label: status };
  }

  function getDeadlineColor(deadline) {
    if (!deadline) return '#9ca3af';
    const days = Math.ceil((new Date(deadline) - new Date()) / MS_PER_DAY);
    if (days < 0) return '#ef4444';
    if (days <= 1) return '#f59e0b';
    return '#6b7280';
  }

  return (
    <div className={styles.root}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titleWrap}>
            <h1 className={styles.title}>БАТЧИНГ ЗАКАЗОВ</h1>
            <span className={styles.sub}>Batch Optimization</span>
          </div>
          <div className={styles.kpis}>
            <div className={styles.kpi}>
              <span className={styles.kpiVal}>{batches.length}</span>
              <span className={styles.kpiLabel}>групп</span>
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiVal}>{batches.reduce((s, b) => s + b.items.length, 0)}</span>
              <span className={styles.kpiLabel}>заказов</span>
            </div>
            {totalPotentialSavings && (
              <div className={styles.kpi}>
                <span className={`${styles.kpiVal} ${styles.kpiValGreen}`}>{totalPotentialSavings}</span>
                <span className={styles.kpiLabel}>экономия</span>
              </div>
            )}
          </div>
        </div>
        <button className={styles.backBtn} onClick={() => navigate('/')}>← К цехам</button>
      </header>

      {/* Content */}
      <main className={styles.main}>
        {batches.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>📋</div>
            <div className={styles.emptyTitle}>Нет подходящих групп для батчинга</div>
            <div className={styles.emptySub}>Группировка возможна для заказов с одинаковой техникой печати и цветом текстиля со статусом "Готово" или "Ожидает"</div>
          </div>
        ) : (
          <div className={styles.batches}>
            {batches.map((batch, idx) => {
              const totalQty = batch.items.reduce((s, i) => s + i.qty, 0);
              const savings = formatSavings(batch.tech, batch.items.length);
              const readyCount = batch.items.filter(i => i.status === 'ready').length;

              return (
                <div key={`${batch.tech}::${batch.color}`} className={styles.batchCard}>
                  <div className={styles.batchHeader}>
                    <div className={styles.batchTitleRow}>
                      <span className={styles.batchNum}>#{idx + 1}</span>
                      <span className={styles.batchLabel}>
                        {batch.techName}
                        <span className={styles.batchSep}>·</span>
                        {batch.colorName} текстиль
                        <span className={styles.batchSep}>·</span>
                        {batch.items.length} {batch.items.length === 1 ? 'заказ' : batch.items.length < 5 ? 'заказа' : 'заказов'}
                      </span>
                    </div>
                    <div className={styles.batchMeta}>
                      <span className={styles.batchQty}>{totalQty} шт итого</span>
                      {savings && (
                        <span className={styles.batchSavings}>
                          Экономия переналадки: {savings}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ready indicator */}
                  <div className={styles.batchReadiness}>
                    <div
                      className={styles.readinessBar}
                      style={{ width: `${Math.round((readyCount / batch.items.length) * 100)}%` }}
                    />
                    <span className={styles.readinessLabel}>
                      {readyCount} из {batch.items.length} готово к запуску
                    </span>
                  </div>

                  {/* Orders list */}
                  <div className={styles.ordersList}>
                    {batch.items.map(item => {
                      const dot = getStatusDot(item.status);
                      const deadlineColor = getDeadlineColor(item.deadline);
                      const deadlineFmt = item.deadline
                        ? new Date(item.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                        : '—';

                      return (
                        <div key={item.taskId} className={styles.orderRow}>
                          <span
                            className={styles.orderDot}
                            style={{ background: dot.color }}
                            title={dot.label}
                          />
                          <span className={styles.orderNum}>{item.orderNumber}</span>
                          <span className={styles.orderClient}>{item.clientName}</span>
                          <span className={styles.orderQty}>{item.qty} шт</span>
                          <span className={styles.orderDeadline} style={{ color: deadlineColor }}>
                            {deadlineFmt}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Action hint */}
                  {readyCount === batch.items.length && (
                    <div className={styles.batchAction}>
                      Все заказы готовы — можно запускать в одном прогоне
                    </div>
                  )}
                  {readyCount > 0 && readyCount < batch.items.length && (
                    <div className={`${styles.batchAction} ${styles.batchActionPartial}`}>
                      {readyCount} заказ(а) готово — ожидайте остальных или запускайте частично
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Info note */}
        <div className={styles.infoNote}>
          Батчинг группирует заказы по технике печати и цвету ткани, чтобы сократить количество переналадок оборудования. Экономия рассчитывается как: шелкография — 2ч на переналадку, DTF — 1,5ч.
        </div>
      </main>
    </div>
  );
}
