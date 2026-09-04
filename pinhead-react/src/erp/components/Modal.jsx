import { useId } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from '../styles';

/**
 * Модальное окно раздела — ОДНА оболочка вместо шести рукописных.
 *
 * §4.3 обхода 04.09: `role="dialog" aria-modal="true"` + `useFocusTrap`
 * + оверлей с `role="presentation"` + `stopPropagation` на самой панели
 * повторялись в шести местах слово в слово. Копия оболочки диалога — это
 * не дублирование разметки, а дублирование ДОСТУПНОСТИ: пропущенный
 * `useFocusTrap` уводит Tab под оверлей и оставляет Escape без обработчика,
 * причём выглядит окно при этом совершенно нормально. Заметить такое можно
 * только клавиатурой, а проверяют мышью.
 *
 * Заголовок обязателен: `aria-modal` без имени объявляет области имя
 * «диалог», и скринридер сообщает ровно это.
 *

 * Импортирует АГРЕГАТОР `../styles`, а не `erp.module.css`: `.modal`
 * и `.modalOverlay` объявлены в `screens.module.css`. Прямой импорт дал бы
 * `undefined` в `className` — окно нарисовалось бы без оверлея и без панели,
 * молча (сторож `stylesResolve` именно на это и сработал). В критический путь
 * это ничего не возвращает: `Modal` зовут только экраны.
 *
 * `Drawer` остаётся отдельным примитивом: боковая панель отличается
 * не оформлением, а поведением (своя анимация, свой слой `--z-drawer`),
 * и сводить их значило бы завести переключатель вида у окна.
 */
export function Modal({ title, onClose, children, labelledBy, className = '' }) {
  // Без трапа Tab уходит под оверлей, а Escape не закрывает — при объявленном
  // `aria-modal` это прямое нарушение обещания разметки
  const trapRef = useFocusTrap(true, onClose);
  /**
   * Идентификатор берётся у `useId`, а не собирается из заголовка: в `id`
   * попадали бы пробелы и двоеточия («Поставщики: Футер»), а `aria-labelledby`
   * читает значение как СПИСОК идентификаторов через пробел — имя диалога
   * при этом молча теряется, и окно объявляется просто «диалог».
   */
  const autoId = useId();
  const titleId = labelledBy ?? (title ? autoId : undefined);

  return (
    <div className={styles.modalOverlay} role="presentation" onClick={onClose}>
      <div
        ref={trapRef}
        className={`${styles.modal} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        {title && <div id={titleId} className={styles.modalTitle}>{title}</div>}
        {children}
      </div>
    </div>
  );
}
