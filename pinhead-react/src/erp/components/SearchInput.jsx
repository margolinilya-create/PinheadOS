import styles from '../erp.module.css';

/**
 * Единая строка поиска для всех разделов производства (правка 5).
 * Одинаковый вид/поведение; матчер — на стороне экрана (utils/orderSearch).
 */
export function SearchInput({ value, onChange, placeholder = 'Поиск…', ariaLabel = 'Поиск' }) {
  return (
    <input
      type="search"
      className={`${styles.input} ${styles.searchInput}`}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
    />
  );
}
