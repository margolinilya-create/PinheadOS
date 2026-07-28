import { useScrollHints } from '../../hooks/useScrollHints';
import styles from '../erp.module.css';

/**
 * Обёртка для горизонтально прокручиваемого блока: показывает градиенты у краёв,
 * когда часть содержимого не видна.
 *
 * Хук `useScrollHints` в проекте был, но применялся только к вкладкам цехов.
 * Таблица дашборда при этом уезжала вправо вместе с колонкой «Статус», а доска
 * канбана при шести участках (~1810px) не помещалась на ноутбуке — и ни там,
 * ни там ничего не сообщало, что справа ещё есть содержимое.
 */
export function ScrollHintBox({ className, children, label }) {
  const { ref, hints } = useScrollHints();
  return (
    <div className={styles.scrollHintWrap}>
      <div className={className} ref={ref} role={label ? 'region' : undefined} aria-label={label}>
        {children}
      </div>
      {hints.left && <div className={`${styles.scrollFade} ${styles.scrollFadeL}`} aria-hidden="true" />}
      {hints.right && <div className={`${styles.scrollFade} ${styles.scrollFadeR}`} aria-hidden="true" />}
    </div>
  );
}
