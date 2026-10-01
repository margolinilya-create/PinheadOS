import { useState } from 'react';
import { Button } from '../../components/Button';
import styles from '../../styles';

/**
 * ВЕС РУЛОНОВ, ПРИНЯТЫХ ДО ПРАВКИ 21.09 (решение заказчика).
 *
 * Приёмка заводила рулоны пустыми, и на бою веса нет ни у одного из сорока
 * одного. Без веса закрой не покажет остаток, а разложить принятое поровну
 * нельзя: это выдуманные цифры в учётных данных, и остаток по ним был бы
 * неверным. Поэтому вес указывает склад — той же проверкой суммы, что
 * при приёмке, и только там, где рулоны без веса действительно есть.
 */
export function LegacyRollWeights({ material: m, unitLabel, onSave }) {
  const pending = (m.rolls ?? []).filter((r) => r.qty == null);
  const known = (m.rolls ?? []).filter((r) => r.qty != null)
    .reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);

  if (pending.length === 0) return null;

  const received = Number(m.qty_received ?? 0);
  const filled = pending.every((r) => Number(values[r.id]) > 0);
  const sum = Math.round((known + pending.reduce(
    (acc, r) => acc + Math.max(Number(values[r.id]) || 0, 0), 0,
  )) * 100) / 100;
  const mismatch = filled && received > 0 && Math.abs(sum - received) > 0.01;

  const save = async () => {
    setSaving(true);
    const ok = await onSave(m.id, pending.map((r) => ({ roll_id: r.id, qty: Number(values[r.id]) })));
    setSaving(false);
    if (ok) setValues({});
  };

  return (
    <div className={styles.tzBlock}>
      <span className={styles.fieldLabel}>
        Вес принятых рулонов{unitLabel ? `, ${unitLabel}` : ''}
      </span>
      <span className={styles.subText}>
        Эти рулоны приняты до того, как появился ввод веса. Без него закрой
        не посчитает остаток ткани.
      </span>
      <div className={styles.cutSizes}>
        {pending.map((r) => (
          <label key={r.id} className={styles.cutSizeRow}>
            <span className={styles.dataCardFieldLabel}>{r.label}</span>
            <input
              type="number" min="0" step="0.01" inputMode="decimal"
              className={`${styles.input} ${styles.qtySmallInput}`}
              value={values[r.id] ?? ''}
              disabled={saving}
              aria-label={`Вес рулона ${r.label}, ${m.name}`}
              onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <span className={styles.subText} role="status">
        Сумма весов: <b>{sum}</b>{unitLabel ? ` ${unitLabel}` : ''}
        {received > 0 && ` из принятых ${received}`}
        {mismatch && ' — не сходится'}
      </span>
      <Button variant="secondary" size="sm" disabled={saving || !filled || mismatch} onClick={save}>
        Записать вес рулонов
      </Button>
    </div>
  );
}
