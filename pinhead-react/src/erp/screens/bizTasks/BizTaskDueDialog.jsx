import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { factoryDateTimeToIso, formatDue } from '../../../utils/date';
import base from '../../styles';
import styles from './BizTaskCard.module.css';

const REASON_MAX = 2000;

/**
 * ПЕРЕНОС СРОКА (правки 19.10, п. 7, «Сроки и просрочка»). Срок меняет
 * постановщик или руководитель с правом, и только С ПРИЧИНОЙ: писатель
 * `erp_biz_task_update` без неё отвечает 22023, а история хранит прежний
 * и новый срок вместе с причиной. Срок — по Москве, как во всей ERP.
 *
 * Прежний срок — в подписи окна; поле нового срока пустое.
 *
 * `onConfirm(patch)` — промис «удалось ли»; отказ уже объявлен тостом стора,
 * окно с введённым остаётся.
 */
export function BizTaskDueDialog({ dueAt, onConfirm, onClose }) {
  // Поле пустое: новый срок вводят заново, прежний — в заголовке окна
  const [due, setDue] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const iso = factoryDateTimeToIso(due);
  const same = iso !== '' && Date.parse(iso) === Date.parse(dueAt);
  const missing = [];
  if (!iso || same) missing.push('новый срок');
  if (!reasonText.trim()) missing.push('причина переноса');
  const reason = missing.length ? `Укажите: ${missing.join(', ')}` : '';

  const confirm = async () => {
    if (reason || busy) return;
    setBusy(true);
    const ok = await onConfirm({ due_at: iso, due_reason: reasonText.trim() });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title="Перенести срок" onClose={onClose} closeOnOverlay={false} closeOnEscape={false}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <p className={styles.muted}>Сейчас: {formatDue(dueAt)}</p>
        <Field
          label="Новый срок, МСК"
          type="datetime-local"
          required
          autoFocus
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <Field
          as="textarea"
          label="Причина переноса"
          required
          rows={3}
          maxLength={REASON_MAX}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
        />
        <div className={base.modalActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button type="submit" variant="primary" loading={busy} ariaDisabledReason={reason}>Перенести</Button>
        </div>
      </form>
    </Modal>
  );
}
