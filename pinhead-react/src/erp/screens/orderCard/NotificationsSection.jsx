import { Link } from 'react-router-dom';
import { deptShortName } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { PROCUREMENT_CAUSE_LABELS, PROCUREMENT_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Центр уведомлений по заказу (правка 7, лёгкий вариант): открытые задачи дозакупки —
 * что / с какого этапа / причина / статус + быстрый переход в раздел «Закупка».
 * Данные — из уже загруженных procurement_tasks (без новой таблицы уведомлений).
 */
export function NotificationsSection({ order, stageById, deptById }) {
  const open = (order.procurement_tasks ?? []).filter(
    (t) => t.status !== 'done' && t.status !== 'cancelled');
  if (open.length === 0) return null;

  return (
    <section className={`${styles.matSection} ${styles.queueCardUrgent}`}>
      <div className={styles.matSectionHead}>
        <strong>🔔 Требуют внимания ({open.length})</strong>
        <Link to="/purchasing" className="btn btn-secondary">→ Закупка</Link>
      </div>
      <ul className={styles.tzMatList}>
        {open.map((t) => {
          const info = t.source_stage_id ? stageById.get(t.source_stage_id) : null;
          const dept = info ? deptById.get(info.st.department_id) : null;
          return (
            <li key={t.id}>
              <strong>{t.material_name}</strong>
              {t.rework_qty ? ` · ${t.rework_qty} шт` : ''}
              <span className={styles.subText}>
                {dept ? ` · с этапа «${deptShortName(dept.code, dept.name)}»` : ''}
                {t.cause_type ? ` · ${PROCUREMENT_CAUSE_LABELS[t.cause_type]}` : ''}
                {' · '}{PROCUREMENT_STATUS_LABELS[t.status]}
                {t.planned_date ? ` · план ${formatDateShort(t.planned_date)}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
