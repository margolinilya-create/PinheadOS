import { printMethodProfile } from '../../../model/printMethods';
import { hasPlacedLayout } from '../../model/layoutMark';
import styles from '../DesignTab.module.css';

/**
 * «Без холста» — нанесения позиции, которых нет на силуэте: зоны без вида
 * (рукав, капюшон, штанина — решение владельца 3), строки без файла, раскладки
 * на другом силуэте. Правятся строками на вкладке «Изделие» (`onOpenItem`).
 *
 * Раскладка, которую холст не показывает (силуэт снят администратором, в новой
 * версии нет зоны), на «Изделии» всё ещё держит строку «на холсте» — зона и мм
 * там только для чтения. Такой строке — «Освободить раскладку» (`onRelease`:
 * `layout = null`): строка становится обычной, правится на «Изделии» или
 * ставится на холст заново. Без этого её можно было бы только удалить.
 */
export default function UnplacedList({ prints, flatId, readOnly, onOpenItem, onRelease }) {
  if (prints.length === 0) return null;
  return (
    <section className={styles.section} aria-label="Нанесения без холста">
      <h3 className={styles.sectionTitle}>Без холста</h3>
      <ul className={styles.issues}>
        {prints.map(({ print, index }) => {
          const stuck = hasPlacedLayout(print.layout, flatId);
          return (
            <li key={print.key}>
              Нанесение {index + 1} · {print.zone || 'без зоны'} · {printMethodProfile(print.method).label}
              {stuck && ' · раскладка для силуэта, которого здесь нет'}
              {stuck && !readOnly && (
                <button
                  type="button"
                  className={styles.btn}
                  aria-label={`Освободить раскладку нанесения ${index + 1}`}
                  onClick={() => onRelease(print.key)}
                >
                  Освободить раскладку
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className={styles.muted}>Эти нанесения задаются строками — размер, зона и отступ на вкладке «Изделие».</p>
      <div className={styles.row}>
        <button type="button" className={styles.btn} onClick={onOpenItem}>Открыть нанесения</button>
      </div>
    </section>
  );
}
