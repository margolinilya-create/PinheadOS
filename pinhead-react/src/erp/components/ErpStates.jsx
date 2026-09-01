import { Icon } from './Icon';
import { Button } from './Button';
import { UPDATE_TITLE, UPDATE_MESSAGE } from '../../lib/appUpdate';
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
 * Вкладка открыта со старой версией: чанк экрана исчез после выкатки.
 *
 * Это НЕ отказ связи, и совет «проверьте связь и повторите» здесь вредный:
 * связь в порядке, а повтор просит файл, которого по старому адресу больше нет.
 * Планшет в цеху держат открытым сутками — именно там этот отказ и наступает.
 *
 * Перезагружаем ТОЛЬКО по нажатию: в соседней форме может быть набран отчёт
 * по этапу или количество в приёмке, и молчаливый reload съел бы набранное.
 * Слова — общие с глобальной границей (`lib/appUpdate`), чтобы одно и то же
 * событие не описывалось в проекте двумя разными текстами.
 */
export function ScreenOutdated({ onReload = () => window.location.reload() }) {
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <span className={`${styles.icon} ${styles.iconError}`}><Icon name="refresh" size={30} /></span>
      <span className={styles.title}>{UPDATE_TITLE}</span>
      <span className={styles.text}>{UPDATE_MESSAGE}</span>
      <span className={styles.action}>
        <Button variant="primary" icon="refresh" onClick={onReload}>Обновить страницу</Button>
      </span>
    </div>
  );
}

/**
 * Данные есть, но под подбор ничего не попало.
 * `query` показывается в кавычках, если искали текстом, — так виднее, что искали.
 */
/**
 * `resetLabel` — потому что на одном экране может быть две кнопки сброса:
 * своя в панели фильтров и эта. Одинаковые подписи путают и человека, и тесты
 * (Playwright в strict mode падает на двух совпадениях по имени).
 */
export function EmptyResult({ query = '', onReset, children, icon = 'search', resetLabel = 'Сбросить' }) {
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
          <Button variant="secondary" onClick={onReset}>{resetLabel}</Button>
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
