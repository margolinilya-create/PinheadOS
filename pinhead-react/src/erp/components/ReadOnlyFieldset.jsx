import styles from '../erp.module.css';

/**
 * Блок «только просмотр»: без права содержимое остаётся видимым, но неактивным.
 *
 * Нативный `fieldset[disabled]` гасит ВСЕ вложенные поля и кнопки разом. В отличие
 * от `pointer-events: none` он честен для клавиатуры и скринридера, а в отличие от
 * `disabled` на каждом элементе не забудет ни одного из двух десятков — а забыть
 * ровно один и значит оставить кнопку, которая отвечает 42501.
 *
 * Экран без права делается на ЧТЕНИЕ, а не прячется: кладовщику полезно видеть,
 * что происходит с заказом, даже если двигать задачу он не может.
 */
export function ReadOnlyFieldset({ canManage, note, children }) {
  if (canManage) return children;
  return (
    <fieldset disabled className={styles.readonlyFieldset}>
      {note && <p className={styles.subText}>{note}</p>}
      {children}
    </fieldset>
  );
}
