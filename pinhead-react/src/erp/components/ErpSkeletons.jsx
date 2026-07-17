import { Skeleton } from '../../components/shared/Skeleton';
import styles from '../erp.module.css';

/**
 * Скелетоны загрузки ERP-экранов (п.34): форма повторяет финальный лейаут
 * (высоты плиток/строк/карточек), чтобы контент не «прыгал» после загрузки.
 */

/** KPI-плитки + карточки цехов — обзор производства (ErpDashboard) */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Загрузка обзора производства">
      <div className={styles.kpiGrid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.kpiTile}>
            <Skeleton width={64} height={34} />
            <Skeleton width="70%" height={12} style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className={styles.cardGrid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.card}>
            <Skeleton width="60%" height={17} />
            <Skeleton width="85%" height={24} radius={999} style={{ marginTop: 12 }} />
          </div>
        ))}
      </div>
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

/** Карточки очереди цеха (DepartmentQueue) */
export function QueueSkeleton({ cards = 3 }) {
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
