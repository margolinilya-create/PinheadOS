import { ariaSortFor } from '../utils/tableSort';
import styles from '../erp.module.css';

/**
 * Заголовок-кнопка сортируемой колонки. Кнопка, а не `onClick` на `<th>`:
 * заголовок должен получать фокус с клавиатуры и жаться Enter/Space,
 * а `aria-sort` объявляет скринридеру текущее направление.
 *
 * Стрелка показана всегда (↕ у неактивной) — иначе о возможности сортировать
 * узнают только случайным кликом.
 */
export function SortableTh({ sortKey, sort, onSort, children, label }) {
  const active = sort.key === sortKey;
  const name = label || (typeof children === 'string' ? children : sortKey);
  const hint = active && sort.dir === 'asc'
    ? `${name}: сейчас по возрастанию, дальше по убыванию`
    : active
      ? `${name}: сейчас по убыванию, дальше без сортировки`
      : `Сортировать по «${name}»`;
  return (
    <th aria-sort={ariaSortFor(sort, sortKey)} className={active ? styles.thSorted : undefined}>
      <button type="button" className={styles.thSortBtn} onClick={() => onSort(sortKey)} title={hint}>
        <span>{children}</span>
        <span className={styles.thSortArrow} aria-hidden="true">
          {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}
