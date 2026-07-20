/** Форматтеры дат карточки заказа (общие для под-компонентов) */
export const fmt = (d) => (d ? new Date(d).toLocaleDateString('ru-RU') : '—');
export const fmtTs = (d) =>
  (d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
