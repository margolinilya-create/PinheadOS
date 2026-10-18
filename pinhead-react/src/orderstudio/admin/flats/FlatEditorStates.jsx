import { useState } from 'react';
import { brokenText, flatConflictText, LOAD_ERROR_TEXT, missingText, withViewsFrom } from './flatEditorView';
import styles from './FlatEditor.module.css';

/** Состояния редактора без черновика: загрузка, нет флэта, битая запись, справочник не прочитан */
export function FlatEditorEmpty({ ed, flatId, onBack, canRepair }) {
  if (ed.state === 'loading') {
    return (
      <div className={styles.skeleton} aria-busy="true" aria-label="Загрузка флэта">
        <div className={styles.skelBlock} />
        <div className={styles.skelBlock} />
      </div>
    );
  }
  if (ed.state === 'missing') {
    return (
      <div className={styles.notice} role="status">
        <p>{missingText(flatId)}</p>
        <button type="button" className="btn" onClick={onBack}>К списку флэтов</button>
      </div>
    );
  }
  if (ed.state === 'broken') {
    return (
      <div className={styles.notice} role="alert">
        <div>
          <p>{brokenText(flatId)}</p>
          <ul>{ed.issues.slice(0, 20).map((t, i) => <li key={`${i}-${t}`}>{t}</li>)}</ul>
        </div>
        {canRepair && <button type="button" className="btn" onClick={ed.repair}>Открыть для исправления</button>}
      </div>
    );
  }
  return (
    <div className={styles.notice} role="alert">
      <p>{LOAD_ERROR_TEXT}</p>
      <button type="button" className="btn" onClick={ed.reload}>Загрузить снова</button>
    </div>
  );
}

/**
 * Плашка над редактором (`role="alert"`, фокус после отказа): конфликт записи
 * с «Загрузить свежую версию», отказ сохранения текстом, а после свежей
 * версии — «Применить выбранные файлы к свежей записи»
 */
export function FlatNotice({ ed }) {
  const [handled, setHandled] = useState(null);
  const kinds = Object.keys(ed.files);
  if (ed.state === 'conflict') {
    return (
      <div id="flat-notice" className={styles.notice} role="alert" tabIndex={-1}>
        <p>{flatConflictText(ed.draft?.name ?? '')}</p>
        <button type="button" className="btn" onClick={ed.reload}>Загрузить свежую версию</button>
      </div>
    );
  }
  if (ed.state === 'error' && ed.errorText) {
    return (
      <div id="flat-notice" className={styles.notice} role="alert" tabIndex={-1}>
        <p>{ed.errorText}</p>
      </div>
    );
  }
  if (ed.state === 'ready' && ed.previousDraft && ed.previousDraft !== handled && ed.draft && kinds.length > 0) {
    const apply = () => {
      ed.setDraft((f) => withViewsFrom(f, ed.previousDraft, kinds));
      setHandled(ed.previousDraft);
    };
    const drop = () => {
      for (const k of kinds) ed.setFile(k, null);
      setHandled(ed.previousDraft);
    };
    return (
      <div id="flat-notice" className={styles.notice} role="status" tabIndex={-1}>
        <p>Загружена свежая версия флэта. Выбранные SVG остались — примените их к свежей записи или уберите.</p>
        <button type="button" className="btn" onClick={apply}>Применить выбранные файлы к свежей записи</button>
        <button type="button" className="btn" onClick={drop}>Убрать выбранные файлы</button>
      </div>
    );
  }
  return null;
}
