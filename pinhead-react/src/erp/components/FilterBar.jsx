import { SearchInput } from './SearchInput';
import styles from '../erp.module.css';

/**
 * Единая панель фильтров (редизайн): поиск слева, произвольные фильтр-чипы посередине,
 * справа — сводка/действия (`right`). Собирается из существующих SearchInput/чипов.
 */
export function FilterBar({
  search, onSearch, searchPlaceholder = 'Поиск…', searchLabel = 'Поиск', children, right,
}) {
  return (
    <div className={styles.filterBar}>
      {onSearch && (
        <SearchInput
          value={search} onChange={onSearch}
          placeholder={searchPlaceholder} ariaLabel={searchLabel}
        />
      )}
      {children}
      <div className={styles.spacer} />
      {right}
    </div>
  );
}
