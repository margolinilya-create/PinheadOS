// redesign/v2 — Workshop Board
//
// Live view of approved/locked tech operations grouped by section.
// Read-only — drag-reassign deferred.

import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWorkshopStore } from '../../../store/useWorkshopStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { Skeleton } from '../../shared/Skeleton';
import s from './v2.module.css';

export default function WorkshopBoard() {
  useDocumentTitle('Цех');
  const sections = useWorkshopStore((st) => st.sections);
  const operationsBySection = useWorkshopStore((st) => st.operationsBySection);
  const loading = useWorkshopStore((st) => st.loading);
  const loadBoard = useWorkshopStore((st) => st.loadBoard);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const kpis = useMemo(() => {
    let totalOps = 0;
    let totalMinutes = 0;
    let totalValue = 0;
    const orderIds = new Set();
    for (const ops of Object.values(operationsBySection)) {
      for (const op of ops) {
        totalOps++;
        totalMinutes += (op.minutes_snapshot || 0) * op.qty;
        totalValue += (op.rate_snapshot || 0) * op.qty;
        orderIds.add(op.order_id);
      }
    }
    return {
      orders: orderIds.size,
      ops: totalOps,
      hours: (totalMinutes / 60).toFixed(1),
      value: Math.round(totalValue),
    };
  }, [operationsBySection]);

  const totalOps = kpis.ops;

  if (loading && sections.length === 0) {
    return (
      <div className={s.pageWide}>
        <h1>Цех</h1>
        <div className={s.skeletonRow}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      </div>
    );
  }

  return (
    <div className={s.pageWide}>
      <h1>Цех</h1>
      <p className={s.subtitle}>
        {sections.length} участков, <strong>{totalOps}</strong> операций в работе
      </p>

      <div className={s.kpiGrid}>
        <div className={s.kpiTile}>
          <div className={s.kpiLabel}>Заказов</div>
          <div className={s.kpiValue}>{kpis.orders}</div>
          <div className={s.kpiSub}>В работе</div>
        </div>
        <div className={s.kpiTile}>
          <div className={s.kpiLabel}>Операций</div>
          <div className={s.kpiValue}>{kpis.ops}</div>
          <div className={s.kpiSub}>Утверждённых задач</div>
        </div>
        <div className={s.kpiTile}>
          <div className={s.kpiLabel}>Часов</div>
          <div className={s.kpiValue}>{kpis.hours}</div>
          <div className={s.kpiSub}>Норма-часов в очереди</div>
        </div>
        <div className={s.kpiTile}>
          <div className={s.kpiLabel}>Сумма</div>
          <div className={s.kpiValue}>{kpis.value.toLocaleString('ru-RU')}₽</div>
          <div className={s.kpiSub}>Сделка по утверждённым ставкам</div>
        </div>
      </div>

      <div
        className={s.columnBoard}
        style={{ gridTemplateColumns: `repeat(${Math.max(1, sections.length)}, minmax(220px, 1fr))` }}
      >
        {sections.map((section) => {
          const ops = operationsBySection[section.id] ?? [];
          return (
            <div key={section.id} className={s.column} style={{ borderTopColor: section.color ?? undefined }}>
              <h3 className={s.columnHeading}>
                <span style={{ color: section.color ?? undefined }}>{section.name}</span>
                <span className={s.columnCount}>{ops.length}</span>
              </h3>
              {ops.length === 0 ? (
                <p className={s.empty}>Нет задач</p>
              ) : (
                ops.map((op) => (
                  <Link key={op.id} to={`/tech-cards/${op.order_id}`} className={s.opCard}>
                    <div className={s.opCardTitle}>{op.name_snapshot}</div>
                    <div className={s.opCardMeta}>
                      {op.order_number ?? op.order_id.slice(0, 8)} · {op.qty} {op.unit_snapshot}
                    </div>
                    <div className={s.opCardCost}>
                      {(op.rate_snapshot * op.qty).toFixed(0)}₽ · {op.minutes_snapshot * op.qty}мин
                    </div>
                  </Link>
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
