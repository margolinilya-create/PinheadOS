import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import base from '../../styles';

/** Пределы писателя `erp_biz_task_transition`: результат — 10 000, прочее — 2 000 */
const RESULT_MAX = 10000;
const TEXT_MAX = 2000;

/**
 * ДИАЛОГ ПЕРЕХОДА С ТЕКСТОМ (правки 19.10, п. 7) — приостановка, возврат,
 * отмена, сдача и завершение. Текст обязателен: без него писатель ответит
 * 22023, и кнопка честно говорит об этом заранее (`aria-disabled` с причиной;
 * `disabled` — только на время запроса).
 *
 * `onConfirm(text)` — промис «удалось ли»: отказ писателя уже объявлен тостом
 * стора, а окно с набранным текстом остаётся — человек не теряет написанное.
 * Окно формы не закрывается промахом мимо панели: только своей кнопкой.
 */
export function BizTaskActionDialog({ text, initial = '', onConfirm, onClose }) {
  const [value, setValue] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  const reason = trimmed ? '' : `Укажите: ${text.field.toLowerCase()}`;

  const confirm = async () => {
    if (reason || busy) return;
    setBusy(true);
    const ok = await onConfirm(trimmed);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={text.title} onClose={onClose} closeOnOverlay={false} closeOnEscape={false}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <Field
          as="textarea"
          label={text.field}
          required
          autoFocus
          rows={4}
          maxLength={text.field === 'Результат' ? RESULT_MAX : TEXT_MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className={base.modalActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{text.cancel}</Button>
          <Button type="submit" variant="primary" loading={busy} ariaDisabledReason={reason}>
            {text.confirm}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
