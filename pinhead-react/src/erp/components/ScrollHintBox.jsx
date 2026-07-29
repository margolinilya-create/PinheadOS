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
 *
 * `tabIndex` ставится ТОЛЬКО когда есть что прокручивать: прокручиваемая область
 * обязана быть достижима с клавиатуры (WCAG 2.1.1), но вешать лишнюю остановку
 * табуляции на блок, который целиком помещается на экране, — шум для навигации.
 */
export function ScrollHintBox({ className, children, label, wrapClassName }) {
  const { ref, hints } = useScrollHints();
  const scrollable = hints.left || hints.right;
  return (
    // wrapClassName — внешние отступы блока. Раньше они стояли инлайном на
    // обёртке таблицы (`style={{ marginTop: 8 }}`); при переносе на ScrollHintBox
    // их некуда было деть, а инлайновые размеры в этом проекте под запретом:
    // они перебивают @media (pointer: coarse).
    <div className={wrapClassName ? `${styles.scrollHintWrap} ${wrapClassName}` : styles.scrollHintWrap}>
      <div
        className={className}
        ref={ref}
        role={label ? 'region' : undefined}
        aria-label={label}
        tabIndex={scrollable ? 0 : undefined}
      >
        {children}
      </div>
      {hints.left && <div className={`${styles.scrollFade} ${styles.scrollFadeL}`} aria-hidden="true" />}
      {hints.right && <div className={`${styles.scrollFade} ${styles.scrollFadeR}`} aria-hidden="true" />}
    </div>
  );
}
