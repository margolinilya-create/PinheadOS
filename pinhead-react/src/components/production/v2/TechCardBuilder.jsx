// redesign/v2 — Tech Card Builder stub
//
// W3 Day-1 scope: smoke-test the full wiring end to end —
//   feature flag → route → store load → render.
// Full UI (drag-reorder, template apply, approve button with snapshot
// freeze) lands in subsequent W3 days once this is verified working.

import { useEffect } from 'react';
import { useTechCardStore } from '../../../store/useTechCardStore';

export default function TechCardBuilder() {
  const sections = useTechCardStore((s) => s.sections);
  const operationTypes = useTechCardStore((s) => s.operationTypes);
  const catalogLoaded = useTechCardStore((s) => s.catalogLoaded);
  const loading = useTechCardStore((s) => s.loading);
  const loadCatalog = useTechCardStore((s) => s.loadCatalog);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  if (loading && !catalogLoaded) {
    return <div className="panel-loading">Загрузка каталога…</div>;
  }

  return (
    <div className="container">
      <h1>Tech Card Builder <span style={{ opacity: 0.5, fontSize: '0.6em' }}>(W3 stub)</span></h1>
      <p style={{ opacity: 0.7 }}>
        Каталог загружен: <strong>{sections.length}</strong> участков,{' '}
        <strong>{operationTypes.length}</strong> операций.
      </p>
      {sections.map((section) => {
        const ops = operationTypes.filter((op) => op.section_id === section.id);
        return (
          <section key={section.id} style={{ marginBottom: 'var(--space-4)' }}>
            <h2 style={{ color: section.color ?? undefined }}>
              {section.name} <span style={{ opacity: 0.5 }}>({ops.length})</span>
            </h2>
            <ul>
              {ops.map((op) => (
                <li key={op.id}>
                  {op.name} — <code>{op.base_rate}₽</code> / {op.unit}, {op.base_minutes} мин
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
