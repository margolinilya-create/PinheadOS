import { useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS, MATERIAL_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Задача склада «Приёмка материалов» (правка 4.1.3): сравнение План↔Факт по каждому материалу.
 * План (материал/цвет/артикул/кол-во) заводит закупка и он read-only для склада; кладовщик вносит
 * только факт (что фактически поступило + кол-во) и статус приёмки. Приёмка разблокирует закрой
 * (гейт в routes.ts) и закрывает задачу в warehouseSlice.acceptMaterial.
 */

const KIND_LABELS = {
  fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки', packaging: 'Упаковка', other: 'Прочее',
};

const ACCEPT_CHIP = {
  accepted_full: 'chipReady',
  accepted_partial: 'chipProgress',
  shortage: 'chipBlocked',
  mismatch: 'chipBlocked',
  rejected: 'chipBlocked',
};

/** Материал ждёт приёмки: пришёл, но склад ещё не провёл (или отклонил) приёмку */
function awaitsAcceptance(m) {
  if (m.status !== 'received') return false;
  return m.accept_status !== 'accepted_full' && m.accept_status !== 'accepted_partial';
}

/** Приёмка одного материала: план read-only слева, факт (заполняет кладовщик) справа */
function AcceptBlock({ material: m, onAccept }) {
  const done = !awaitsAcceptance(m) && m.accept_status;
  // Факт-атрибуты преднаполняются планом — кладовщик правит только при пересорте/расхождении
  const [factName, setFactName] = useState(m.fact_name ?? m.name ?? '');
  const [factColor, setFactColor] = useState(m.fact_color ?? m.color ?? '');
  const [factArticle, setFactArticle] = useState(m.fact_article ?? m.article ?? '');
  const [received, setReceived] = useState(m.qty_received ?? '');
  const [status, setStatus] = useState(m.accept_status ?? 'accepted_full');
  const [comment, setComment] = useState(m.accept_comment ?? '');
  const [saving, setSaving] = useState(false);

  const accept = async () => {
    setSaving(true);
    await onAccept(m.id, {
      qty_received: received === '' ? null : Number(received),
      accept_status: status,
      accept_comment: comment.trim() || null,
      fact_name: factName.trim() || null,
      fact_color: factColor.trim() || null,
      fact_article: factArticle.trim() || null,
    });
    setSaving(false);
  };

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>{m.name}</strong>
          <div className={styles.subText}>{KIND_LABELS[m.kind]} · {MATERIAL_STATUS_LABELS[m.status]}</div>
        </div>
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[m.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[m.accept_status]}
            {m.accepted_at ? ` · ${formatDateShort(m.accepted_at)}` : ''}
          </span>
        )}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Поле</th><th>План (закупка)</th><th>Факт (склад)</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Материал</td>
              <td>{m.name || '—'}</td>
              <td>
                <input className={styles.input} value={factName}
                  onChange={(e) => setFactName(e.target.value)} aria-label={`Факт материал ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Цвет</td>
              <td>{m.color || '—'}</td>
              <td>
                <input className={styles.input} value={factColor}
                  onChange={(e) => setFactColor(e.target.value)} aria-label={`Факт цвет ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Артикул</td>
              <td>{m.article || '—'}</td>
              <td>
                <input className={styles.input} value={factArticle}
                  onChange={(e) => setFactArticle(e.target.value)} aria-label={`Факт артикул ${m.name}`} />
              </td>
            </tr>
            <tr>
              <td>Количество, кг</td>
              <td>{m.qty_expected ?? '—'}</td>
              <td>
                <input type="number" min="0" step="0.01" className={styles.input} value={received}
                  placeholder="факт" onChange={(e) => setReceived(e.target.value)}
                  aria-label={`Факт количество ${m.name}`} style={{ maxWidth: 120 }} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}
          aria-label={`Статус приёмки ${m.name}`}>
          {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <input className={styles.input} style={{ flex: 1, minWidth: 160 }} placeholder="Комментарий"
          value={comment} onChange={(e) => setComment(e.target.value)}
          aria-label={`Комментарий приёмки ${m.name}`} />
        <button type="button" className="btn btn-primary" disabled={saving} onClick={accept}>
          {done ? 'Обновить приёмку' : 'Принять'}
        </button>
      </div>
    </div>
  );
}

export function MaterialReceiptCard({ order, task, onAccept }) {
  const accepted = task.status === 'accepted';
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка материалов</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        {accepted && <span className={`${styles.chip} ${styles.chipDone}`}>Материалы приняты</span>}
      </div>
      {order.materials.map((m) => (
        <AcceptBlock key={m.id} material={m} onAccept={onAccept} />
      ))}
    </section>
  );
}
