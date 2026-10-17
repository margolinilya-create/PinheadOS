import { printMethodProfile } from '../../../model/printMethods';
import styles from '../DesignTab.module.css';

/**
 * «Без холста» — нанесения позиции, которых нет на силуэте: зоны без вида
 * (рукав, капюшон, штанина — решение владельца 3), строки без файла, раскладки
 * на другом силуэте. Правятся строками на вкладке «Изделие» (`onOpenItem`).
 */
export default function UnplacedList({ prints, onOpenItem }) {
  if (prints.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Нанесения без холста">
      <h3 className={styles.sectionTitle}>Без холста</h3>
      <ul className={styles.issues}>
        {prints.map(({ print, index }) => (
          <li key={print.key}>
            Нанесение {index + 1} · {print.zone || 'без зоны'} · {printMethodProfile(print.method).label}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>Эти нанесения задаются строками — размер, зона и отступ на вкладке «Изделие».</p>
      <div className={styles.row}>
        <button type="button" className={styles.btn} onClick={onOpenItem}>Открыть нанесения</button>
      </div>
    </section>
  );
}
