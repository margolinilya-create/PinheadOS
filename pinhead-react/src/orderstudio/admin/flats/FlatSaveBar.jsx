import { useEffect, useRef } from 'react';
import { toast } from '../../../store/useToastStore';
import { pluralize } from '../../../utils/i18n';
import { revertGeometry } from '../../design/edit/flatEdit';
import FlatChecks from './FlatChecks';
import { releaseHint, saveButtonLabel, saveDoneText, saveProgressText, spokenSaveText } from './flatEditorView';
import styles from './FlatEditor.module.css';

const SAVABLE = ['ready', 'error'];

/**
 * Низ редактора (sticky): замечания проверки, кнопка, называющая результат
 * («Создать флэт» / «Сохранить флэт» / «Выпустить версию N»), подсказка
 * выпуска, «Отменить правки силуэта» и прогресс. Закрытая кнопка объясняет
 * себя через `aria-describedby`. Итог — тост; фокус после выпуска — на бейдж
 * версии, после создания — на заголовок, после отказа — на плашку.
 */
export default function FlatSaveBar({ ed, check, isNew, readOnly, onGo, focusSoon }) {
  /** Что сохранили — итог объявляется, когда хук дорисует свежую запись */
  const done = useRef(null);
  const errors = check.errors.length;
  const disabled = readOnly || errors > 0 || !ed.dirty || !SAVABLE.includes(ed.state);
  const why = errors ? `Исправьте ${errors} ${pluralize(errors, 'ошибку', 'ошибки', 'ошибок')} — список выше` : '';
  const release = !isNew && ed.geometry;

  useEffect(() => {
    const was = done.current;
    if (!was || ed.state !== 'ready') return;
    done.current = null;
    const released = was.release ? ed.base?.version ?? null : null;
    toast.success(saveDoneText({ isNew: was.isNew, released }));
    focusSoon(was.isNew ? 'flat-editor-title' : released ? 'flat-version-badge' : null);
  }, [ed.state, ed.base, focusSoon]);

  const save = async () => {
    done.current = { isNew, release };
    if (!(await ed.save())) {
      done.current = null;
      focusSoon('flat-notice');
    }
  };

  const revert = () => {
    ed.setDraft((d) => revertGeometry(ed.base, d));
    for (const k of Object.keys(ed.files)) ed.setFile(k, null);
  };

  return (
    <div className={styles.saveBar}>
      <FlatChecks check={check} onGo={onGo} />
      <div className={styles.saveRow}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={disabled}
          aria-busy={ed.state === 'saving' || undefined}
          aria-describedby={[why ? 'flat-save-why' : null, release ? 'flat-release-hint' : null].filter(Boolean).join(' ') || undefined}
        >
          {saveButtonLabel({ isNew, geometry: ed.geometry, nextVersion: ed.nextVersion })}
        </button>
        {release && !readOnly && (
          <button type="button" className="btn" onClick={revert}>Отменить правки силуэта</button>
        )}
        {ed.state === 'saving' && <span className={styles.status} aria-hidden="true">{saveProgressText(ed.progress) || 'Сохраняю…'}</span>}
      </div>
      {why && <p id="flat-save-why" className={styles.hint}>{why}</p>}
      {release && <p id="flat-release-hint" className={styles.hint}>{releaseHint(ed.base?.version ?? 1)}</p>}
      <p className={styles.srOnly} role="status" aria-live="polite">{ed.state === 'saving' ? spokenSaveText(ed.progress) : ''}</p>
    </div>
  );
}
