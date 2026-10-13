import { useState } from 'react';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { deptShortName } from '../../data/departments';
import { toast } from '../../../store/useToastStore';
import styles from '../../styles';

/**
 * Передача задачи разработки в цех (ТЗ п.14).
 *
 * Форма, а не диалог с вводом: цех выбирается из списка, а не набирается
 * руками — вариантов полдесятка, и попросить напечатать код значило бы
 * заставить человека их помнить.
 *
 * Ключевое отличие от прежнего `OpForm`: цех здесь НЕ обязателен по умолчанию,
 * потому что сама форма необязательна. Образец по умолчанию шьётся в ЭКС,
 * а передача — отдельное действие над уже существующей задачей (ТЗ п.6:
 * «передача в основной швейный цех является исключением/опцией, а не
 * обязательной стадией»).
 */
export function DevSendToDept({ task, taskName, departments, onSend, onCancel }) {
  const [deptId, setDeptId] = useState('');
  const [planned, setPlanned] = useState(task.due_date || '');
  const [qty, setQty] = useState(task.qty != null ? String(task.qty) : '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!deptId) { toast.error('Выберите цех'); return; }
    setBusy(true);
    const ok = await onSend(task.id, {
      department_id: deptId,
      planned_end: planned || null,
      qty: qty === '' ? null : Number(qty),
    });
    setBusy(false);
    if (ok) onCancel();
  };

  return (
    <div className={styles.tzBlock}>
      <div className={styles.fieldLabel}>Передать «{taskName}» в цех</div>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Цех</span>
          <select
            className={styles.select}
            value={deptId}
            onChange={(e) => setDeptId(e.target.value)}
            aria-label="Цех для задачи разработки"
          >
            <option value="">Выберите цех…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{deptShortName(d.code, d.name)}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Срок</span>
          <DateField value={planned} onChange={setPlanned} aria-label="Плановый срок в цехе" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Количество</span>
          <input
            type="number" min="1" className={styles.input}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="шт"
            aria-label="Количество единиц"
          />
        </label>
      </div>
      <p className={styles.subText}>
        В очереди цеха появится задание с пометкой «образец». Дальше его ведёт
        цех: статус задачи здесь будет только показываться.
      </p>
      <div className={styles.modalActions}>
        <Button variant="ghost" onClick={onCancel}>Отмена</Button>
        <Button variant="primary" disabled={busy} onClick={submit}>Передать</Button>
      </div>
    </div>
  );
}
