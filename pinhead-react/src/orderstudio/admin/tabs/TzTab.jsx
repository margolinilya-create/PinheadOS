import { useCatalogEditor } from '../useCatalogEditor';
import CatalogNotice from '../CatalogNotice';
import SaveBar from './SaveBar';
import { footerOf, withFooter, FOOTER_MAX, canEdit } from './rulesForm';
import base from '../../screens/Sales.module.css';
import styles from './RulesTabs.module.css';

const NAME = 'Подвал ТЗ';

/**
 * Вкладка «Подвал ТЗ» (веха 4, задача 5): текст под позициями технического
 * задания (`app_config.tzSettings.footerText`, `catalog_put`). По умолчанию —
 * «Допуск по размещению нанесения — до 2 см» (сид миграции G).
 */
export default function TzTab({ readOnly }) {
  const editor = useCatalogEditor('app_config', 'tzSettings');
  const editable = canEdit(editor, readOnly);
  const text = footerOf(editor.value);
  const over = text.length > FOOTER_MAX;

  return (
    <section className={base.panel} aria-labelledby="tz-footer-head">
      <h2 id="tz-footer-head" className={base.panelTitle}>Подвал ТЗ</h2>
      <CatalogNotice editor={editor} name={NAME} />
      {editor.state !== 'loading' && (
        <>
          <label className={base.field}>
            Текст подвала
            <textarea
              className={base.textarea}
              rows={4}
              value={text}
              maxLength={FOOTER_MAX}
              disabled={!editable}
              aria-describedby="tz-footer-hint"
              onChange={(e) => editor.setValue((prev) => withFooter(prev, e.target.value))}
            />
          </label>
          <p id="tz-footer-hint" className={styles.hint}>
            Печатается под позициями каждого ТЗ. До {FOOTER_MAX.toLocaleString('ru-RU')} знаков, сейчас {text.length.toLocaleString('ru-RU')}.
          </p>
        </>
      )}
      <SaveBar
        editor={editor}
        label="Сохранить подвал ТЗ"
        done="Подвал ТЗ сохранён"
        invalid={over}
        readOnly={readOnly}
      />
    </section>
  );
}
