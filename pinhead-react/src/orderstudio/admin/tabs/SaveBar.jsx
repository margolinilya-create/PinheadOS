import { toast } from '../../../store/useToastStore';
import { SAVABLE } from './rulesForm';
import styles from './RulesTabs.module.css';

/**
 * Низ вкладки справочника: кнопка, называющая результат («Сохранить упаковку»),
 * и строка состояния. Закрыта на телефоне, без правок, с ошибкой в полях
 * и пока справочник не прочитан из базы (запасной путь, конфликт).
 */
export default function SaveBar({ editor, label, done, invalid = false, readOnly = false }) {
  const disabled = readOnly || invalid || !editor.dirty || !SAVABLE.includes(editor.state);
  const save = async () => {
    if (await editor.save()) toast.success(done);
  };
  let status = '';
  if (editor.state === 'saving') status = 'Сохраняю…';
  else if (invalid) status = 'Исправьте поля, отмеченные выше';
  else if (editor.dirty && SAVABLE.includes(editor.state)) status = 'Есть несохранённые правки';
  return (
    <div className={styles.footer}>
      <button type="button" className="btn btn-primary" onClick={save} disabled={disabled}>{label}</button>
      {status && <span className={styles.status} role="status">{status}</span>}
    </div>
  );
}
