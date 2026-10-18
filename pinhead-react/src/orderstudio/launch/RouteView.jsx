import { useMemo } from 'react';
import { routeRows } from './launchView';
import styles from './Launch.module.css';

/**
 * Маршрут на «К запуску» — только просмотр, без стора ERP (К22): тип
 * производства и техники по позициям из чистого моста. Подписи техник —
 * `METHOD_LABELS` модели (одна подпись техники на экране). Точный маршрут
 * (этапы и цеха) строит производство при запуске.
 *
 * @param {{ order: import('../model/types').SalesOrder, warnings: string[] }} props
 */
export default function RouteView({ order, warnings }) {
  const rows = useMemo(() => routeRows(order), [order]);
  return (
    <section className={styles.block} aria-labelledby="launch-route">
      <h3 id="launch-route" className={styles.blockTitle}>Маршрут</h3>
      <ul className={styles.route}>
        {rows.map((r) => (
          <li key={r.key}>
            <strong>{r.name}</strong>, {r.qty} шт. — {r.production}
            {r.methods.length > 0 && <>; нанесения {r.brandingOn}: {r.methods.join(', ')}</>}
          </li>
        ))}
      </ul>
      {warnings.length > 0 && (
        <ul className={styles.warnList} aria-label="Предупреждения моста">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <p className={styles.muted}>Точный маршрут построит производство при запуске</p>
    </section>
  );
}
