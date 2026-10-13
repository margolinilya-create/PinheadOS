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
/**
 * `closeOnOverlay` / `closeOnEscape` — ФОРМА ВВОДА НЕ ЗАКРЫВАЕТСЯ СЛУЧАЙНО
 * (правка заказчика 01.10, п. 3): «клик вне формы не должен её закрывать:
 * всё заполненное остаётся». У окна-справки промах мимо панели — законный
 * способ закрыть, у формы с набранными данными — потеря работы без вопроса.
 * Поэтому умолчание прежнее (`true`), а формы ввода передают `false`
 * и закрываются только своей кнопкой «Отмена»/✕.
 */
export function Modal({
  title, onClose, children, labelledBy, className = '',
  closeOnOverlay = true, closeOnEscape = true,
}) {
  // Без трапа Tab уходит под оверлей. Escape закрывает только там, где это
  // безопасно: у формы ввода трап держит фокус, но окно не снимает
  const trapRef = useFocusTrap(true, closeOnEscape ? onClose : undefined);
  /**
   * Идентификатор берётся у `useId`, а не собирается из заголовка: в `id`
   * попадали бы пробелы и двоеточия («Поставщики: Футер»), а `aria-labelledby`
   * читает значение как СПИСОК идентификаторов через пробел — имя диалога
   * при этом молча теряется, и окно объявляется просто «диалог».
   */
  const autoId = useId();
  const titleId = labelledBy ?? (title ? autoId : undefined);

  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onClick={closeOnOverlay ? onClose : undefined}
    >
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
