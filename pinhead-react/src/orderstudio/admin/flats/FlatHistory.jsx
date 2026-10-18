import { historyText } from './flatEditorView';
import styles from './FlatEditor.module.css';

/** Вкладка «История»: прежние версии геометрии, только чтение (К1) */
export default function FlatHistory({ flat }) {
  const list = [...(flat.history ?? [])].sort((a, b) => b.version - a.version);
  return (
    <section className={styles.section} aria-labelledby="flat-history-head" id="flat-history" tabIndex={-1}>
      <h3 id="flat-history-head" className={styles.sectionHead}>История версий</h3>
      <p className={styles.hint}>{`Текущая — версия ${flat.version}. Прежние версии не меняются: по ним рисуются старые заказы`}</p>
      {list.length === 0 ? (
        <p className={styles.hint}>Прежних версий нет</p>
      ) : (
        <ul className={styles.history}>
          {list.map((e) => <li key={e.version}>{historyText(e)}</li>)}
        </ul>
      )}
    </section>
  );
}
