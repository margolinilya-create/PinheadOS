import { useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS, MATERIAL_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Задача склада «Приёмка материалов»: числовая сверка план/факт + статус приёмки
 * по каждому материалу заказа. Приёмка разблокирует закрой (гейт в routes.ts) и
 * закрывает задачу (материалы приняты) в warehouseSlice.acceptMaterial.
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

/** Строка приёмки одного материала (числовая сверка план/факт + статус + комментарий) */
function AcceptRow({ material, onUpdateMaterial, onAccept }) {
  const done = !awaitsAcceptance(material) && material.accept_status;
  const [received, setReceived] = useState(material.qty_received ?? '');
  const [status, setStatus] = useState(material.accept_status ?? 'accepted_full');
  const [comment, setComment] = useState(material.accept_comment ?? '');
  const [saving, setSaving] = useState(false);

  const accept = async () => {
    setSaving(true);
    await onAccept(material.id, {
      qty_received: received === '' ? null : Number(received),
      accept_status: status,
      accept_comment: comment.trim() || null,
    });
    setSaving(false);
  };

  return (
    <tr>
      <td>
        <strong>{material.name}</strong>
        <div className={styles.subText}>{KIND_LABELS[material.kind]} · {MATERIAL_STATUS_LABELS[material.status]}</div>
      </td>
      <td>
        <input
          type="number" min="0" className={`${styles.input} ${styles.inputSm}`} style={{ maxWidth: 90 }}
          defaultValue={material.qty_expected ?? ''}
          placeholder="план"
          aria-label={`План поступления ${material.name}`}
          onBlur={(e) => {
            const v = e.target.value === '' ? null : Number(e.target.value);
            if (v !== (material.qty_expected ?? null)) onUpdateMaterial(material.id, { qty_expected: v });
          }}
        />
      </td>
      <td>
        <input
          type="number" min="0" className={`${styles.input} ${styles.inputSm}`} style={{ maxWidth: 90 }}
          value={received} placeholder="факт"
          aria-label={`Фактически поступило ${material.name}`}
          onChange={(e) => setReceived(e.target.value)}
        />
      </td>
      <td>
        <select
          className={styles.select} value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={`Статус приёмки ${material.name}`}
        >
          {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </td>
      <td>
        <input
          className={styles.input} style={{ maxWidth: 160 }} placeholder="Комментарий"
          value={comment} onChange={(e) => setComment(e.target.value)}
          aria-label={`Комментарий приёмки ${material.name}`}
        />
      </td>
      <td>
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[material.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[material.accept_status]}
            {material.accepted_at ? ` · ${formatDateShort(material.accepted_at)}` : ''}
          </span>
        )}
        <button type="button" className="btn btn-primary" disabled={saving} onClick={accept}>
          {done ? 'Обновить приёмку' : 'Принять'}
        </button>
      </td>
    </tr>
  );
}

export function MaterialReceiptCard({ order, task, onUpdateMaterial, onAccept }) {
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
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Материал</th><th>План</th><th>Факт</th><th>Статус приёмки</th><th>Комментарий</th><th>Действие</th></tr>
          </thead>
          <tbody>
            {order.materials.map((m) => (
              <AcceptRow key={m.id} material={m} onUpdateMaterial={onUpdateMaterial} onAccept={onAccept} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
