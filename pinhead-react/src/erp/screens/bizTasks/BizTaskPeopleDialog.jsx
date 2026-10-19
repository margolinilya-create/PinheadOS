import { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { PersonPicker } from './PersonPicker';
import base from '../../styles';

/** Лимит писателя (Р8) */
const MAX_WATCHERS = 20;

/**
 * СМЕНА ОТВЕТСТВЕННОГО И СОСТАВА НАБЛЮДАТЕЛЕЙ (правки 19.10, п. 7).
 *
 * `people` — только сотрудники ERP (активная карточка): иного писатель
 * `erp_biz_task_update` отвергнет 22023. Постановщик и ответственный
 * наблюдателями не бывают — их нет в выборе: участник учитывается один раз.
 * Уже стоящего наблюдателя, уволенного с тех пор, снять можно: его id остаётся
 * в значении, хотя в выборе его нет.
 */
export function BizTaskPeopleDialog({ mode, task, watchers, people, onConfirm, onClose }) {
  const isAssignee = mode === 'assignee';
  const [value, setValue] = useState(() => (isAssignee ? [task.assignee_id] : [...watchers]));
  const [busy, setBusy] = useState(false);

  const changed = isAssignee
    ? value[0] && value[0] !== task.assignee_id
    : value.length !== watchers.length || value.some((id) => !watchers.includes(id));
  const reason = !changed ? (isAssignee ? 'Выберите нового ответственного' : 'Состав не изменился') : '';

  const confirm = async () => {
    if (reason || busy) return;
    setBusy(true);
    const ok = await onConfirm(isAssignee ? { assignee_id: value[0] } : { watchers: value });
    setBusy(false);
    if (ok) onClose();
  };

  const choices = isAssignee
    ? people
    : people.filter((p) => p.user_id !== task.creator_id && p.user_id !== task.assignee_id);

  return (
    <Modal title={isAssignee ? 'Сменить ответственного' : 'Наблюдатели'} onClose={onClose} closeOnOverlay={false} closeOnEscape={false}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void confirm(); }}>
        <PersonPicker
          label={isAssignee ? 'Ответственный' : 'Наблюдатели'}
          multiple={!isAssignee}
          max={MAX_WATCHERS}
          people={choices}
          value={value}
          onChange={setValue}
        />
        <div className={base.modalActions}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button type="submit" variant="primary" loading={busy} ariaDisabledReason={reason}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}
