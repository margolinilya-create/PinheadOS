import { catalogConflictText, CATALOG_FALLBACK_TEXT } from './useCatalogEditor';
import styles from './OrderSettings.module.css';

/**
 * Состояние редактора справочника над вкладкой (`useCatalogEditor`): конфликт
 * записи и запасной путь — с кнопкой загрузки свежей версии. Остальные
 * состояния вкладка показывает сама (кнопка сохранения называет результат).
 *
 * `name` — имя справочника в тексте конфликта («Поставщики и палитры»).
 */
export default function CatalogNotice({ editor, name }) {
  if (editor.state === 'conflict') {
    return (
      <div className={styles.notice} role="alert">
        <p>{catalogConflictText(name)}</p>
        <button type="button" className="btn" onClick={editor.reload}>Загрузить свежую версию</button>
      </div>
    );
  }
  if (editor.state === 'fallback') {
    return (
      <div className={styles.notice} role="status">
        <p>{CATALOG_FALLBACK_TEXT}</p>
        <button type="button" className="btn" onClick={editor.reload}>Загрузить снова</button>
      </div>
    );
  }
  if (editor.state === 'loading') {
    return <p className={styles.loading} role="status">Загрузка справочника…</p>;
  }
  return null;
}
