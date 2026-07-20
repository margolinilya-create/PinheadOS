import { Skeleton } from '../../../components/shared/Skeleton';
import { deptShortName } from '../../data/departments';
import {
  ORDER_STATUS_LABELS,
  SHIPPED_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { fmt, fmtTs } from './format';

const AUDIT_FIELD_LABELS = {
  title: 'Название',
  manager: 'Менеджер',
  bitrix_id: '№ сделки',
  launch_date: 'Дата запуска',
  due_date: 'Срок клиента',
  buffer_days: 'Буфер, дн',
  priority: 'Приоритет',
  status: 'Статус заказа',
  shipped_status: 'Отгрузка',
  delivered_at: 'Сдан',
  notes: 'Заметка',
  packaging: 'Упаковка',
  packaging_note: 'Упаковка: уточнение',
  stickers: 'Стикеры',
  stickers_note: 'Стикеры: уточнение',
  no_chestny_znak: 'Без Честного знака',
  planned_start: 'План этапа: начало',
  planned_end: 'План этапа: конец',
};

/** Поля-даты аудита — показываем в русском формате */
const AUDIT_DATE_FIELDS = new Set([
  'launch_date', 'due_date', 'delivered_at', 'planned_start', 'planned_end',
]);

/** Читабельные значения аудита: статусы, даты и флаги — на русском */
function auditValue(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'status') return ORDER_STATUS_LABELS[v] || v;
  if (field === 'shipped_status') return SHIPPED_STATUS_LABELS[v] || v;
  if (field === 'packaging') return PACKAGING_LABELS[v] || v;
  if (field === 'stickers') return STICKERS_LABELS[v] || v;
  if (field === 'no_chestny_znak') return v === 'true' ? 'да' : 'нет';
  if (AUDIT_DATE_FIELDS.has(field)) return fmt(v);
  return v;
}

/** Секция «История»: события этапов + правки заказа, слитые и отсортированные */
export function HistorySection({ events, audit, stageById, deptById }) {
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}><strong>История</strong></div>
      {events === null && <Skeleton width="45%" height={12} />}
      {events && events.length === 0 && (!audit || audit.length === 0) && (
        <div className={styles.subText}>Событий пока нет — история пишется при смене статусов и правках.</div>
      )}
      {events && (events.length > 0 || (audit && audit.length > 0)) && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Когда</th><th>Кто</th><th>Этап</th><th>Что</th></tr>
            </thead>
            <tbody>
              {[
                ...(events ?? []).map((ev) => ({ kind: 'stage', at: ev.created_at, row: ev })),
                ...(audit ?? []).map((a) => ({ kind: 'audit', at: a.changed_at, row: a })),
              ]
                .sort((x, y) => y.at.localeCompare(x.at))
                .slice(0, 120)
                .map(({ kind, row }) => {
                  if (kind === 'audit') {
                    return (
                      <tr key={`a-${row.id}`}>
                        <td className={styles.subText}>{fmtTs(row.changed_at)}</td>
                        <td>{row.changed_by || '—'}</td>
                        <td><span className={`${styles.chip} ${styles.chipNeutral}`}>правка</span></td>
                        <td>
                          {AUDIT_FIELD_LABELS[row.field_name] || row.field_name}:{' '}
                          <span className={styles.subText}>{auditValue(row.field_name, row.old_value)}</span>
                          {' → '}
                          <strong>{auditValue(row.field_name, row.new_value)}</strong>
                        </td>
                      </tr>
                    );
                  }
                  const ev = row;
                  const info = stageById.get(ev.stage_id);
                  const dept = info ? deptById.get(info.st.department_id) : null;
                  return (
                    <tr key={`e-${ev.id}`}>
                      <td className={styles.subText}>{fmtTs(ev.created_at)}</td>
                      <td>{ev.actor || '—'}</td>
                      <td>{dept ? deptShortName(dept.code, dept.name) : '—'}
                        {info?.it?.variant ? ` · ${info.it.variant}` : ''}
                      </td>
                      <td>
                        {STAGE_STATUS_LABELS[ev.to_status] || ev.to_status}
                        {ev.qty_done ? ` · ${ev.qty_done} шт` : ''}
                        {ev.qty_rework ? ` · брак ${ev.qty_rework} шт` : ''}
                        {ev.comment && <div className={styles.subText}>{ev.comment}</div>}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
