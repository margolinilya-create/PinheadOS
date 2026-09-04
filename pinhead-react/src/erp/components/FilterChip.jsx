import styles from '../erp.module.css';

/**
 * Чип-фильтр — «включено/выключено», а не переход.
 *
 * §4.3 обхода 04.09: одна и та же связка `chip + chipBtn + (chipProgress |
 * chipNeutral)` с `aria-pressed` повторялась двадцать один раз, и повторялась
 * НЕ ЦЕЛИКОМ: где-то `aria-pressed` был, где-то нет. Для скринридера это
 * разница между «фильтр „Просрочено", нажат» и просто «Просрочено» —
 * то есть между работающим фильтром и кнопкой без состояния.
 *
 * `role="tab"` здесь не ставится сознательно: половина таб-паттерна хуже
 * обычной кнопки (записанное правило проекта). Чипы — независимые
 * переключатели, а не вкладки одной панели.
 */
export function FilterChip({ active = false, onClick, children, label }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      className={`${styles.chip} ${styles.chipBtn} ${active ? styles.chipProgress : styles.chipNeutral}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
