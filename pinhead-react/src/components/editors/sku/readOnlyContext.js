import { createContext, useContext } from 'react';

/**
 * «Только просмотр» вкладки цен (телефон, ≤ 760 px, К2 вехи 8) — контекстом,
 * а не `<fieldset disabled>` вокруг вкладки: закрытый fieldset делает
 * недостижимыми и прокручиваемые области таблиц внутри него (axe
 * `scrollable-region-focusable`), а таблицы цен на 375 px прокручиваются.
 * Поля сами берут `disabled` отсюда.
 */
export const ReadOnlyContext = createContext(false);

export const useReadOnly = () => useContext(ReadOnlyContext);
