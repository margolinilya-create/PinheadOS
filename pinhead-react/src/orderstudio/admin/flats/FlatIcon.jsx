import { createElement } from 'react';
import { FLAT_ICONS } from './flatIcons';

/**
 * Иконка редактора флэта: `<FlatIcon name="trash" />` (набор — `flatIcons.ts`,
 * почему не `DesignIcon` — там же). Поведение — как у `DesignIcon`: по умолчанию
 * декоративная (`aria-hidden`), подпись даёт текст кнопки или её `aria-label`;
 * с `title` — `role="img"` и доступное имя. Неизвестное имя — ничего не рисуется.
 */
export function FlatIcon({ name, size = 18, className, title }) {
  const shapes = FLAT_ICONS[name];
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
