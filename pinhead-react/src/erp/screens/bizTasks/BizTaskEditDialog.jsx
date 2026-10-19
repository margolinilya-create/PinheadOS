import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { kindHints } from '../../utils/bizTasks';
import base from '../../styles';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 10000;

/**
 * ПРАВКА НАЗВАНИЯ И ОПИСАНИЯ (правки 19.10, п. 7): постановщик и руководитель
 * с правом, пока задача открыта (`edit` в `bizTaskActions`). В историю писатель
 * кладёт «Изменено: название, описание» — сами тексты история не копирует.
 * Отправляются только изменённые поля.
 */
export function BizTaskEditDialog({ task, onConfirm, onClose }) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [busy, setBusy] = useState(false);
  const hints = kindHints(task.kind);

  const patch = {};
  if (title.trim() !== task.title) patch.title = title.trim();
  if (description.trim() !== (task.description ?? '').trim()) patch.description = description.trim() || null;
  const reason = !title.trim() ? 'Укажите название'
    : Object.keys(patch).length === 0 ? 'Ничего не изменилось' : '';

  const confirm = async () => {
    if (reason || busy) return;
    setBusy(true);
    const ok = await onConfirm(patch);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title="Изменить описание" onClose={onClose} closeOnOverlay={false} closeOnEscape={false}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <Field
          label="Название"
          required
          autoFocus
          maxLength={TITLE_MAX}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Field
          as="textarea"
          label="Описание"
          rows={6}
          maxLength={DESCRIPTION_MAX}
          hint={hints.length ? `В описании укажите: ${hints.join(', ')}` : undefined}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className={base.modalActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button type="submit" variant="primary" loading={busy} ariaDisabledReason={reason}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}
