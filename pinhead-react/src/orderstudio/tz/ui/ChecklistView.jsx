import { Link } from 'react-router-dom';
import styles from './tz.module.css';

/**
 * Чек-лист «Отправить в работу» (веха 6+7, задача 5): пункты из `sendChecklist`
 * (T2). Блокирующие — сверху, у продавца со ссылкой на место правки
 * (`?tab=item&item=…` / `?tab=client`). Первый блокирующий пункт принимает
 * фокус (`ref`, `tabIndex=-1`): клик по недоступной кнопке ведёт сюда.
 *
 * @param {{ items: import('../model/sendChecklist').CheckItem[], firstRef?: import('react').Ref<HTMLLIElement> }} props
 */
export default function ChecklistView({ items, firstRef }) {
  const open = items.filter((i) => !i.ok);
  const sorted = [...open.filter((i) => i.blocking), ...open.filter((i) => !i.blocking)];
  if (sorted.length === 0) return <p className={styles.ready}>Чек-лист пройден — заказ готов к отправке</p>;
  return (
    <ul className={styles.list} aria-label="Чек-лист отправки">
      {sorted.map((i, n) => (
        <li
          key={i.id}
          ref={n === 0 && i.blocking ? firstRef : undefined}
          tabIndex={n === 0 && i.blocking ? -1 : undefined}
          className={`${styles.item} ${i.blocking ? styles.blocking : styles.warning}`}
        >
          <span>{i.blocking ? 'Нужно исправить: ' : 'Обратите внимание: '}{i.text}</span>
          {i.href && <Link className={styles.fix} to={i.href}>Исправить</Link>}
        </li>
      ))}
    </ul>
  );
}
