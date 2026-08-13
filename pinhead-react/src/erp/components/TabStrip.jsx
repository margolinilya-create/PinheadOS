import { useScrollHints } from '../../hooks/useScrollHints';
import styles from '../erp.module.css';

/**
 * Полоса вкладок с подсказкой горизонтальной прокрутки.
 *
 * Правило проекта — «горизонтально прокручиваемый блок оборачивается
 * в ScrollHintBox» — до 13.08.2026 выполнялось только для таблиц и только
 * для двух полос вкладок из пяти (очередь цеха и план). Справочники админки,
 * разделы админки и вкладки карточки заказа уезжали за край молча: на 1280px
 * полоса справочников требует 1047px при 986px видимых, и последняя вкладка
 * («Единицы измерения») просто отсутствовала на экране.
 *
 * `ScrollHintBox` здесь не подходит: он ставит на контейнер `tabIndex=0` и
 * `role="region"`, а у списка вкладок своя модель доступа — `role="tablist"`
 * плюс roving tabindex на самих вкладках (`utils/tabs`). Вторая остановка
 * табуляции поверх вкладочной навигации мешала бы скринридеру, а не помогала.
 * Поэтому у полосы вкладок общая с таблицами ВИЗУАЛЬНАЯ подсказка и своя
 * клавиатура.
 */
export function TabStrip({ label, className, onKeyDown, children, ...rest }) {
  const { ref, hints } = useScrollHints();
  return (
    <div className={styles.deptTabsWrap}>
      <div
        ref={ref}
        className={className ? `${styles.deptTabs} ${className}` : styles.deptTabs}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        {...rest}
      >
        {children}
      </div>
      {hints.left && <div className={`${styles.deptTabsFade} ${styles.deptTabsFadeL}`} aria-hidden="true" />}
      {hints.right && <div className={`${styles.deptTabsFade} ${styles.deptTabsFadeR}`} aria-hidden="true" />}
    </div>
  );
}
