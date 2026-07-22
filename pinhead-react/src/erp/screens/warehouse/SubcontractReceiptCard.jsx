import { useState } from 'react';
import { SUBCONTRACT_RECEIPT_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';

/**
 * Задача склада «Приёмка продукции от подрядчика» (правка 4.2.1). Обязательная приёмка готового
 * изделия перед статусом «Поступило на производство»: кладовщик проверяет комплектацию/количество/
 * соответствие и подтверждает — тогда подрядная операция переходит в received_at_pinhead, а склад
 * получает задачу упаковки/отгрузки (оркестрация в warehouseSlice.advanceWarehouseTask).
 */

const CHECKS = [
  { key: 'kitting', label: 'Проверена комплектация' },
  { key: 'qty', label: 'Проверено количество' },
  { key: 'match', label: 'Соответствие заказу' },
];

export function SubcontractReceiptCard({ order, task, onAdvance }) {
  const accepted = task.status === 'accepted';
  const [checks, setChecks] = useState({});
  const [saving, setSaving] = useState(false);
  const allChecked = CHECKS.every((c) => checks[c.key]);

  const confirm = async () => {
    setSaving(true);
    await onAdvance(task.id, 'accepted');
    setSaving(false);
  };

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <span className={styles.subText}>Приёмка продукции от подрядчика</span>
          <div><strong>№{order.bitrix_id || '—'} · {order.title}</strong></div>
        </div>
        <span className={`${styles.chip} ${accepted ? styles.chipDone : styles.chipWaiting}`}>
          {SUBCONTRACT_RECEIPT_STATUS_LABELS[task.status] ?? task.status}
        </span>
      </div>
      {accepted ? (
        <div className={styles.subText}>Продукция принята и передана на упаковку/отгрузку.</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
            {CHECKS.map((c) => (
              <label key={c.key} className={styles.checkRow}>
                <input
                  type="checkbox" checked={!!checks[c.key]}
                  onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })}
                />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-primary" disabled={saving || !allChecked} onClick={confirm}>
            Подтвердить приёмку
          </button>
          {!allChecked && (
            <div className={styles.subText} style={{ marginTop: 4 }}>Отметьте все пункты проверки</div>
          )}
        </>
      )}
    </section>
  );
}
