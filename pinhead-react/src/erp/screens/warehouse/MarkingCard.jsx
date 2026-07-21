import { useState } from 'react';
import { formatDateShort } from '../../utils/time';
import { MARKING_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Задача склада «Выпуск маркировки»: авто-создаётся при входе заказа в швейку.
 * Новая → В работе → Маркировка выпущена. Показывает изделия, кол-во, тип маркировки, срок.
 */

const NEXT = { new: 'in_progress', in_progress: 'issued' };
const NEXT_LABEL = { new: 'Взять в работу', in_progress: 'Маркировка выпущена' };

export function MarkingCard({ order, task, onAdvance }) {
  const [markingType, setMarkingType] = useState(task.marking_type ?? '');
  const [deadline, setDeadline] = useState(task.deadline ?? '');
  const [saving, setSaving] = useState(false);
  const next = NEXT[task.status];
  const totalQty = order.items.reduce((s, it) => s + (it.qty || 0), 0);

  const advance = async () => {
    if (!next) return;
    setSaving(true);
    await onAdvance(task.id, next, {
      marking_type: markingType.trim() || null,
      deadline: deadline || null,
    });
    setSaving(false);
  };

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Выпуск маркировки</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
          <div className={styles.subText}>
            {order.items.map((it) => `${it.product_type}${it.variant ? ` · ${it.variant}` : ''} × ${it.qty}`).join('; ')}
            {' · всего '}{totalQty}
          </div>
        </div>
        <span className={`${styles.chip} ${task.status === 'issued' ? styles.chipDone : styles.chipProgress}`}>
          {MARKING_STATUS_LABELS[task.status]}
        </span>
      </div>

      {task.status !== 'issued' && (
        <div className={styles.checkRow}>
          <input
            className={styles.input} style={{ maxWidth: 220 }}
            placeholder="Тип маркировки (напр. Честный знак)"
            value={markingType} onChange={(e) => setMarkingType(e.target.value)}
            aria-label="Тип маркировки"
          />
          <input
            type="date" className={styles.input} style={{ maxWidth: 160 }}
            value={deadline} onChange={(e) => setDeadline(e.target.value)}
            aria-label="Срок выпуска маркировки"
          />
          <button type="button" className="btn btn-primary" disabled={saving} onClick={advance}>
            {NEXT_LABEL[task.status]}
          </button>
        </div>
      )}
      {task.status === 'issued' && (task.marking_type || task.deadline) && (
        <div className={styles.subText}>
          {task.marking_type ? `Тип: ${task.marking_type}` : ''}
          {task.deadline ? ` · срок ${formatDateShort(task.deadline)}` : ''}
        </div>
      )}
    </section>
  );
}
