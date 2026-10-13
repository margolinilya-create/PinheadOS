import { Skeleton } from '../../components/shared/Skeleton';
import { useCompactLayout } from '../layout/useCompactLayout';
import styles from '../erp.module.css';

/**
 * Скелетоны загрузки ERP-экранов (п.34): форма повторяет финальный лейаут
 * (высоты плиток/строк/карточек), чтобы контент не «прыгал» после загрузки.
 *
 * Обещание «повторяет лейаут» приходится держать буквально, иначе смысла нет:
 * дашборд рисовал 4 плитки старого класса, а загружался с шестью карточками
 * нового, и очередь цеха рисовала карточки там, где на десктопе строки.
 */

/** KPI-карточки + два ряда виджетов — обзор производства (ErpDashboard) */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Загрузка обзора производства" className={styles.dash}>
      <div className={styles.dashKpis}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={styles.kpiCard}>
            <Skeleton width={44} height={44} radius={10} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <Skeleton width="70%" height={12} />
              <Skeleton width={52} height={26} style={{ marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>
      {[3, 2].map((count, row) => (
        <div key={row} className={`${styles.dashRow} ${row === 0 ? styles.dashRow3 : styles.dashRow2}`}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className={styles.widget}>
              <div className={styles.widgetHead}>
                <Skeleton width="45%" height={15} />
                <Skeleton width={64} height={12} />
              </div>
              {Array.from({ length: 3 }).map((__, j) => (
                <Skeleton key={j} height={18} style={{ marginTop: j === 0 ? 0 : 10 }} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Строки таблицы — список заказов / производственный план */
export function TableSkeleton({ rows = 6, label = 'Загрузка списка' }) {
  return (
    <div className={styles.tableWrap} role="status" aria-label={label}>
      <div style={{ padding: '4px 12px' }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'center',
              padding: '14px 0',
              borderBottom: i < rows - 1 ? '1px solid var(--border-light)' : 'none',
            }}
          >
            <Skeleton width={44} height={12} />
            <Skeleton width="26%" height={13} />
            <Skeleton width="14%" height={12} />
            <Skeleton width={40} height={12} />
            <Skeleton width="12%" height={12} />
            <Skeleton width={92} height={24} radius={999} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Очередь цеха: на десктопе — компактные строки (QueueRow), на узком экране —
 * карточки (QueueCard). Брейкпоинт тот же, что в DepartmentQueue.
 */
export function QueueSkeleton({ cards = 4 }) {
  const isCompact = useCompactLayout();
  if (!isCompact) {
    return (
      <div className={styles.queueList} role="status" aria-label="Загрузка очереди цеха">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className={styles.queueRow}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '4px 0' }}>
              <Skeleton width={14} height={14} />
              <Skeleton width={40} height={40} radius={6} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <Skeleton width="52%" height={14} />
                <Skeleton width="34%" height={11} style={{ marginTop: 5 }} />
              </div>
              <Skeleton width={70} height={12} />
              <Skeleton width={84} height={20} radius={999} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.queueGrid} role="status" aria-label="Загрузка очереди цеха">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className={styles.queueCard}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Skeleton width={48} height={48} radius={6} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <Skeleton width="72%" height={18} />
              <Skeleton width="55%" height={12} style={{ marginTop: 6 }} />
            </div>
            <Skeleton width={56} height={14} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Skeleton height={46} radius={6} style={{ flex: 1 }} />
            <Skeleton width={110} height={46} radius={6} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Универсальный скелет экрана — Suspense-fallback ленивых чанков */
export function ScreenSkeleton() {
  return (
    <div role="status" aria-label="Загрузка экрана">
      <div className={styles.pageHead}>
        <Skeleton width={260} height={30} />
        <Skeleton width={340} height={13} style={{ marginTop: 8 }} />
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}

/** Колонки производственного канбана — в канбан-виде доски вместо таблицы */
export function KanbanSkeleton({ columns = 4 }) {
  return (
    <div className={styles.kanbanBoard} role="status" aria-label="Загрузка канбана">
      {Array.from({ length: columns }).map((_, i) => (
        <section key={i} className={styles.kanbanCol}>
          <header className={styles.kanbanColHead}><Skeleton width="55%" height={13} /></header>
          {Array.from({ length: 2 }).map((__, j) => (
            <div key={j} className={styles.kanbanLane}>
              <div className={styles.kanbanLaneTitle}><Skeleton width={90} height={10} /></div>
              <Skeleton height={64} radius={8} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
