// redesign/v2 — Workshop Board
//
// Live view of approved/locked tech operations grouped by section.
// Read-only — drag-reassign deferred.

import { useEffect } from 'react';
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

  const totalOps = Object.values(operationsBySection).reduce((sum, ops) => sum + ops.length, 0);

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
