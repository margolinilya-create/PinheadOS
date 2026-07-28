import { Icon } from './Icon';
import { Button } from './Button';
import styles from './States.module.css';

/**
 * Пустое состояние раздела: иконка + заголовок + пояснение + опциональное действие.
 * Заменяет серый текст в рамке (`.emptyState`) — теперь у пустого экрана есть
 * подсказка, что делать дальше.
 */
export function EmptyState({ icon = 'inbox', title, text, action }) {
  return (
    <div className={styles.state}>
      <span className={styles.icon}><Icon name={icon} size={30} /></span>
      {title && <span className={styles.title}>{title}</span>}
      {text && <span className={styles.text}>{text}</span>}
      {action && <span className={styles.action}>{action}</span>}
    </div>
  );
}

/**
 * Ошибка загрузки данных раздела с кнопкой «Повторить».
 * До этого пустой экран без объяснения был открытым пунктом аудита
 * (`docs/erp-audit.md`, раздел NEXT).
 */
export function ErrorState({
  title = 'Не удалось загрузить данные',
  text = 'Проверьте соединение и попробуйте ещё раз.',
  onRetry,
  retryLabel = 'Повторить',
}) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <span className={`${styles.icon} ${styles.iconError}`}><Icon name="alert" size={30} /></span>
      <span className={styles.title}>{title}</span>
      {text && <span className={styles.text}>{text}</span>}
      {onRetry && (
        <span className={styles.action}>
          <Button variant="secondary" icon="refresh" onClick={onRetry}>{retryLabel}</Button>
        </span>
      )}
    </div>
  );
}
