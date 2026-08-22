/**
 * Подписи и соответствия закупки — отдельным модулем от `PurchaseFields`.
 *
 * Не из педантизма: файл, экспортирующий рядом с компонентами константы,
 * ломает fast refresh (правило `react-refresh/only-export-components`), а читают
 * их и таблица, и карточка, и модалка «Новая закупка».
 */

export const KIND_LABELS = {
  fabric: 'Ткань', hardware: 'Фурнитура', labels: 'Бирки/этикетки',
  packaging: 'Упаковка', other: 'Прочее',
};

export const SOURCE_LABELS = {
  purchase: 'Закупка', stock: 'Со склада', client: 'Давальческое', none: 'Без закупки',
};

export const STATUS_VARIANT = {
  pending: 'waiting', ordered: 'progress', in_transit: 'progress',
  partial: 'waiting', received: 'ready', reserved: 'ready', not_needed: 'neutral',
};

/**
 * Колонки строки закупки разбиты на две группы. Разделение «что просил
 * менеджер» и «что сделала закупка» — прямое требование документа (п. 12),
 * и в карточке планшета оно обязано выжить: без него обе роли снова пишут
 * в общий список, и «нужно было 100 м → закупили 110» показать нечем.
 */
export const PURCHASE_GROUPS = [
  { key: 'need', label: 'Потребность — задал менеджер' },
  { key: 'fact', label: 'Факт — ведёт закупка' },
];
