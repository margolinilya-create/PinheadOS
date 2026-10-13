import styles from '../erp.module.css';

/**
 * ЧИПЫ-ПОДСКАЗКИ СПРАВОЧНИКА над полем ввода (правка 12).
 *
 * Значение ДОПИСЫВАЕТСЯ к набранному, а не затирает его: рабочий мог
 * напечатать половину причины, нажать чип и потерять текст. Само дописывание
 * делает вызывающий — здесь только ряд и вызов `onPick(имя)`.
 *
 * ПОЧЕМУ НЕ `FilterChip`. Вид тот же, поведение другое: это не переключатель.
 * `aria-pressed="false"`, навсегда застывший на такой кнопке, объявляет
 * скринридеру «переключатель, выключен» — то есть обещает состояние, которого
 * у неё нет. Примитив заводится по поведению, а не по виду, и здесь поведение
 * второе.
 *
 * Копий было две — местный компонент в `StageActionsPanel` и его побайтовый
 * двойник инлайном в `DefectWizard`, с одинаковым пояснением над обоими.
 */
export function DictionaryChips({ items, onPick, label }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={styles.checkRow} role="group" aria-label={label}>
      {items.map((d) => (
        <button
          key={d.id}
          type="button"
          className={`${styles.chip} ${styles.chipBtn} ${styles.chipNeutral}`}
          onClick={() => onPick(d.name)}
        >
          {d.name}
        </button>
      ))}
    </div>
  );
}
