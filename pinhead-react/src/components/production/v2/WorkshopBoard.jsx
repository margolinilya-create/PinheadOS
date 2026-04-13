// redesign/v2 — Workshop Board (W3 Day-3)
//
// Live view of all approved/locked tech operations grouped by section.
// Read-only columns — drag-and-drop assignment lands in a later day.

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useWorkshopStore } from '../../../store/useWorkshopStore';

export default function WorkshopBoard() {
  const sections = useWorkshopStore((s) => s.sections);
  const operationsBySection = useWorkshopStore((s) => s.operationsBySection);
  const loading = useWorkshopStore((s) => s.loading);
  const loadBoard = useWorkshopStore((s) => s.loadBoard);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  if (loading && sections.length === 0) {
    return <div className="panel-loading">Загрузка цеха…</div>;
  }

  const totalOps = Object.values(operationsBySection).reduce((sum, ops) => sum + ops.length, 0);

  return (
    <div className="container" style={{ maxWidth: 1400 }}>
      <h1>Цех</h1>
      <p style={{ opacity: 0.7 }}>
        {sections.length} участков, <strong>{totalOps}</strong> операций в работе
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, sections.length)}, minmax(220px, 1fr))`,
          gap: 'var(--space-3)',
          marginTop: 'var(--space-3)',
          alignItems: 'start',
        }}
      >
        {sections.map((section) => {
          const ops = operationsBySection[section.id] ?? [];
          return (
            <div
              key={section.id}
              className="panel"
              style={{
                borderTop: `3px solid ${section.color ?? 'var(--color-border)'}`,
              }}
            >
              <h3 style={{ margin: 0, color: section.color ?? undefined }}>
                {section.name}{' '}
                <span style={{ opacity: 0.5, fontWeight: 'normal', fontSize: '0.85em' }}>
                  {ops.length}
                </span>
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                {ops.length === 0 ? (
                  <p style={{ opacity: 0.4, fontSize: '0.85em' }}>Нет задач</p>
                ) : (
                  ops.map((op) => (
                    <Link
                      key={op.id}
                      to={`/tech-cards/${op.order_id}`}
                      className="panel"
                      style={{
                        padding: 'var(--space-2)',
                        textDecoration: 'none',
                        color: 'inherit',
                        fontSize: '0.85em',
                        display: 'block',
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{op.name_snapshot}</div>
                      <div style={{ opacity: 0.6, fontSize: '0.9em', marginTop: 2 }}>
                        {op.order_number ?? op.order_id.slice(0, 8)} · {op.qty} {op.unit_snapshot}
                      </div>
                      <div style={{ opacity: 0.5, fontSize: '0.85em', marginTop: 2 }}>
                        {(op.rate_snapshot * op.qty).toFixed(0)}₽ · {op.minutes_snapshot * op.qty}мин
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
