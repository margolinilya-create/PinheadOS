import { Icon } from './Icon';
import { Button } from './Button';
import styles from './States.module.css';

/**
 * Состояния «данные не пришли» и «поиск ничего не нашёл» — одним компонентом на весь ERP.
 *
 * Флаг `loadError` в сторе был с первой волны, но обрабатывали его три экрана из десяти.
 * Остальные при сбое сети показывали вечный скелетон («Загружаем…», которое никогда
 * не кончится), пустую страницу или — хуже всего — «Выберите свой цех выше»: рабочий
 * решал, что заданий просто нет. Повторить запрос было нечем: эффект `if (!loaded)
 * loadAll()` второй раз не срабатывает, помогала только перезагрузка страницы.
 *
 * Пустой результат — вторая половина той же проблемы: если данные есть, но фильтр
 * или поиск не совпал, часть экранов не рисовала вообще ничего, и отличить
 * «не нашлось» от «сломалось» было невозможно.
 *
 * Внешний вид (иконка + заголовок + пояснение + действие) вынесен в States.module.css:
 * это два главных состояния на весь раздел, и различать их нужно с одного взгляда,
 * а не вчитываться в строку серого текста.
 */

/**
 * Загрузка не удалась — с кнопкой повтора.
 * Рисовать по `loadError && !loaded`: при уже загруженных данных сбой фонового
 * обновления не должен затирать то, что человек читает.
 */
export function LoadFailed({ onRetry, what = 'данные' }) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <span className={`${styles.icon} ${styles.iconError}`}><Icon name="alert" size={30} /></span>
      <span className={styles.title}>Не удалось загрузить {what}</span>
      <span className={styles.text}>Проверьте связь и попробуйте ещё раз.</span>
      {onRetry && (
        <span className={styles.action}>
          <Button variant="secondary" icon="refresh" onClick={onRetry}>Повторить</Button>
        </span>
      )}
    </div>
  );
}

/**
 * Данные есть, но под подбор ничего не попало.
 * `query` показывается в кавычках, если искали текстом, — так виднее, что искали.
 */
export function EmptyResult({ query = '', onReset, children, icon = 'search' }) {
  return (
    <div className={styles.state}>
      <span className={styles.icon}><Icon name={icon} size={30} /></span>
      <span className={styles.text}>
        {children || (query
          ? <>Ничего не найдено по запросу «{query}».</>
          : 'Под фильтры ничего не попало.')}
      </span>
      {onReset && (
        <span className={styles.action}>
          <Button variant="secondary" onClick={onReset}>Сбросить</Button>
        </span>
      )}
    </div>
  );
}

/**
 * Раздел пуст по существу (работы нет), а не из-за фильтра — со своей иконкой
 * и подсказкой, что делать дальше.
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
