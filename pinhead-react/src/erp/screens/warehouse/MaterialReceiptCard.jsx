import { useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MATERIAL_ACCEPT_LABELS, MATERIAL_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Задача склада «Приёмка материалов» (4.1.3): два блока по каждому материалу заказа —
 *   ПЛАН  (из закупки, read-only): материал / цвет / артикул / плановое кол-во (кг);
 *   ФАКТ  (кладовщик вносит вручную): материал / цвет / артикул / принято (кг) / комментарий.
 * Ниже — сверка план/факт с подсветкой расхождений. Приёмка разблокирует закрой
 * (гейт в routes.ts) и закрывает задачу (материалы приняты) в warehouseSlice.acceptMaterial.
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

/** Нормализация для сверки план/факт (регистр и пробелы расхождением не считаем) */
function norm(v) {
  return (v ?? '').toString().trim().toLowerCase();
}

/** Приёмка одного материала: план (read-only) + факт (ввод кладовщика) + сверка */
function AcceptRow({ material, onAccept }) {
  const done = !awaitsAcceptance(material) && material.accept_status;
  // Факт по умолчанию = план (кладовщик правит только расхождения); кол-во вводит сам.
  const [nameAct, setNameAct] = useState(material.name_actual ?? material.name ?? '');
  const [colorAct, setColorAct] = useState(material.color_actual ?? material.color ?? '');
  const [articleAct, setArticleAct] = useState(material.article_actual ?? material.article ?? '');
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
      name_actual: nameAct.trim() || null,
      color_actual: colorAct.trim() || null,
      article_actual: articleAct.trim() || null,
    });
    setSaving(false);
  };

  const planQty = material.qty_expected;
  const factQty = received === '' ? null : Number(received);
  const qtyDelta = planQty != null && factQty != null ? factQty - planQty : null;

  const cmp = [
    { label: 'Материал', plan: material.name, fact: nameAct },
    { label: 'Цвет', plan: material.color, fact: colorAct },
    { label: 'Артикул', plan: material.article, fact: articleAct },
    {
      label: 'Количество',
      plan: planQty != null ? `${planQty} кг` : '',
      fact: factQty != null ? `${factQty} кг` : '',
      mismatch: qtyDelta != null && qtyDelta !== 0,
      delta: qtyDelta,
    },
  ];

  return (
    <div className={styles.receiptRow}>
      <div className={styles.planFactGrid}>
        <div className={styles.planBlock}>
          <div className={styles.fieldLabel}>План · из закупки</div>
          <dl className={styles.kvList}>
            <div><dt>Материал</dt><dd><strong>{material.name}</strong></dd></div>
            <div><dt>Цвет</dt><dd>{material.color || '—'}</dd></div>
            <div><dt>Артикул</dt><dd>{material.article || '—'}</dd></div>
            <div><dt>Плановое кол-во</dt><dd>{material.qty_expected != null ? `${material.qty_expected} кг` : '—'}</dd></div>
          </dl>
          <div className={styles.subText}>{KIND_LABELS[material.kind]} · {MATERIAL_STATUS_LABELS[material.status]}</div>
        </div>

        <div className={styles.factBlock}>
          <div className={styles.fieldLabel}>Факт · приёмка</div>
          <div className={styles.factFields}>
            <label className={styles.factField}>
              <span>Материал</span>
              <input className={styles.input} value={nameAct} onChange={(e) => setNameAct(e.target.value)} aria-label={`Фактический материал ${material.name}`} />
            </label>
            <label className={styles.factField}>
              <span>Цвет</span>
              <input className={styles.input} value={colorAct} onChange={(e) => setColorAct(e.target.value)} aria-label={`Фактический цвет ${material.name}`} />
            </label>
            <label className={styles.factField}>
              <span>Артикул</span>
              <input className={styles.input} value={articleAct} onChange={(e) => setArticleAct(e.target.value)} aria-label={`Фактический артикул ${material.name}`} />
            </label>
            <label className={styles.factField}>
              <span>Принято, кг</span>
              <input type="number" min="0" step="0.01" className={styles.input} value={received} placeholder="факт" onChange={(e) => setReceived(e.target.value)} aria-label={`Фактически поступило ${material.name}`} />
            </label>
            <label className={styles.factField}>
              <span>Статус приёмки</span>
              <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={`Статус приёмки ${material.name}`}>
                {Object.entries(MATERIAL_ACCEPT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className={`${styles.factField} ${styles.factFieldWide}`}>
              <span>Комментарий</span>
              <input className={styles.input} value={comment} placeholder="при необходимости" onChange={(e) => setComment(e.target.value)} aria-label={`Комментарий приёмки ${material.name}`} />
            </label>
          </div>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.cmpTable}`}>
          <thead><tr><th>Поле</th><th>План</th><th>Факт</th></tr></thead>
          <tbody>
            {cmp.map((r) => {
              const mismatch = r.mismatch ?? (norm(r.plan) !== norm(r.fact));
              return (
                <tr key={r.label} className={mismatch ? styles.cmpMismatch : undefined}>
                  <td>{r.label}</td>
                  <td>{r.plan || '—'}</td>
                  <td>
                    {r.fact || '—'}
                    {r.delta != null && r.delta !== 0 && (
                      <span className={styles.subText}> ({r.delta > 0 ? '+' : ''}{r.delta} кг)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.receiptActions}>
        {done && (
          <span className={`${styles.chip} ${styles[ACCEPT_CHIP[material.accept_status]]}`}>
            {MATERIAL_ACCEPT_LABELS[material.accept_status]}
            {material.accepted_at ? ` · ${formatDateShort(material.accepted_at)}` : ''}
          </span>
        )}
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
        <AcceptRow key={m.id} material={m} onAccept={onAccept} />
      ))}
    </section>
  );
}
