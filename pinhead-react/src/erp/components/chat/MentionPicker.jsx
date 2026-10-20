import styles from '../../styles';

/**
 * Подсказка «кого позвать» — список сотрудников под полем ввода.
 *
 * СПИСОК — ЭТО ИСТОЧНИК УПОМИНАНИЯ, а не украшение: адресат считается
 * упомянутым только если его выбрали здесь (`utils/mentions`). Поэтому
 * человек, у которого нет учётной записи, сюда не попадает вовсе —
 * справочник строит сервер из тех, кто может ЧИТАТЬ обсуждение.
 *
 * Клавиатура обязательна: набор идёт в поле ввода, и уводить руки на мышь
 * ради каждого упоминания — это ровно то, из-за чего механизмом
 * перестают пользоваться. ↑/↓ двигают выбор, Enter подставляет,
 * Escape закрывает — обработчики живут в композере, потому что события
 * приходят в textarea, а не сюда.
 */
export function MentionPicker({
  people, activeIndex, onPick, emptyHint,
  /**
   * Имя списка и его `id` — для выбора людей вне композера (ответственный
   * и наблюдатели бизнес-задачи): там список зовётся не «Кого упомянуть»,
   * а поле ввода ссылается на него через `aria-controls`.
   */
  label = 'Кого упомянуть',
  id,
  /** Положение списка: у композера он над полем, в форме — под ним */
  className = '',
}) {
  const box = [styles.mentionBox, className].filter(Boolean).join(' ');
  if (people.length === 0) {
    return (
      <div className={box} role="status" id={id}>
        <span className={styles.subText}>{emptyHint}</span>
      </div>
    );
  }

  return (
    <ul className={box} role="listbox" aria-label={label} id={id}>
      {people.map((p, i) => (
        <li key={p.user_id}>
          <button
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            className={[
              styles.mentionItem,
              i === activeIndex ? styles.mentionItemActive : '',
            ].filter(Boolean).join(' ')}
            /**
             * `onMouseDown`, а не `onClick`: клик сначала уводит фокус
             * из поля ввода, поле закрывает подсказку по `blur`, и выбор
             * не доезжает вовсе.
             */
            onMouseDown={(e) => { e.preventDefault(); onPick(p); }}
          >
            <span className={styles.mentionName}>{p.name}</span>
            {p.email && <span className={styles.mentionEmail}>{p.email}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
