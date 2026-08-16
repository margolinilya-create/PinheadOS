/**
 * Адрес карточки заказа вместе с контекстом возврата.
 *
 * Живёт отдельно от компонента `components/OrderLink.jsx`, потому что тот файл
 * обязан экспортировать ТОЛЬКО компоненты (правило `react-refresh`), а функция
 * нужна там, где ссылки нет вовсе: клик по всей карточке канбана, Enter/Space
 * на ней и переход из KPI-плитки закупки — там переход делает `navigate`.
 *
 * Формат `from` тот же, что у `useScrollRestore` (ключ `pathname + search`):
 * иначе возврат попадёт на другой ключ и позиция прокрутки не восстановится.
 */

interface LocationLike {
  pathname: string;
  search: string;
}

export type OrderNavigateArgs = [string, { state: { from: string } }];

export function orderLinkTarget(
  orderId: string,
  location: LocationLike,
): OrderNavigateArgs {
  return [
    `/orders/${orderId}`,
    { state: { from: `${location.pathname}${location.search}` } },
  ];
}
