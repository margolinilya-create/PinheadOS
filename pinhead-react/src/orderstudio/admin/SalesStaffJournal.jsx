import { STAFF_EVENTS_LIMIT } from '../api/salesStaff';
import { eventText } from './SalesStaffJournalText';
import base from '../screens/Sales.module.css';
import styles from './SalesStaff.module.css';

/**
 * «Кто и когда менял» на «Сотрудниках продаж» (веха 8, К6): журнал
 * `sales_staff_events` пишет триггер на `profiles`, поэтому в нём и служебные
 * смены. Имена — из списка сотрудников экрана (`sales_staff_list` отдаёт
 * руководству все профили; select `profiles` директору и rop показал бы
 * один свой). `events`: `undefined` — грузится, `null` — не загрузился.
 */
export default function SalesStaffJournal({ events, rows, onRetry }) {
  const names = new Map((rows ?? []).map((r) => [r.id, r.name || r.email || 'без имени']));
  const nameOf = (id) => names.get(id) ?? 'профиль не найден';
  return (
    <details className={styles.journal}>
      <summary className={styles.journalSummary}>Кто и когда менял (последние {STAFF_EVENTS_LIMIT})</summary>
      {events === undefined ? (
        <p className={base.muted}>Загрузка…</p>
      ) : events === null ? (
        <div className={styles.journalEmpty}>
          <p>Журнал не загрузился.</p>
          <button type="button" className="btn" onClick={onRetry}>Загрузить журнал снова</button>
        </div>
      ) : events.length === 0 ? (
        <p className={base.muted}>Отметок ещё не меняли</p>
      ) : (
        <ol className={styles.journalList}>
          {events.map((ev) => <li key={ev.id} className={styles.journalItem}>{eventText(ev, nameOf)}</li>)}
        </ol>
      )}
    </details>
  );
}
