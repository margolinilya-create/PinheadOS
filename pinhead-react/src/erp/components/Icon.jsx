import { createElement } from 'react';
import { ICONS } from './icons';

/**
 * Иконка ERP: `<Icon name="orders" />`.
 *
 * По умолчанию декоративная (`aria-hidden`) — подпись даёт соседний текст или
 * `aria-label` кнопки. Если иконка стоит одна и несёт смысл, передайте `title`:
 * тогда svg получает `role="img"` и доступное имя.
 *
 * Неизвестное имя рендерится как ничего — иконка нигде не критична для смысла.
 */
export function Icon({ name, size = 18, className, title }) {
  const shapes = ICONS[name];
  if (!shapes) return null;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {shapes.map(({ t, ...attrs }, i) => createElement(t, { key: i, ...attrs }))}
    </svg>
  );
}
