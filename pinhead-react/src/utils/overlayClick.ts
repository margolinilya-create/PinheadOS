import type { MouseEvent } from 'react';

/**
 * Клик по подложке модального окна.
 *
 * Закрывает окно только клик ПО САМОЙ подложке, а не по содержимому панели.
 * Всплытие гасится здесь же, на подложке: раньше его гасила панель
 * (`onClick={e => e.stopPropagation()}`), и клик внутри окна не доходил
 * до предков — например, до строки таблицы, из которой окно открыто
 * (события React всплывают по дереву компонентов даже из портала).
 * Подложка с `role="presentation"` держит ту же гарантию, а у панели-диалога
 * больше нет обработчика клика, которого не было бы с клавиатуры.
 */
export function overlayClick(onClose?: () => void) {
  return (e: MouseEvent<HTMLElement>): void => {
    e.stopPropagation();
    if (onClose && e.target === e.currentTarget) onClose();
  };
}
