import { createElement } from 'react';
import { DESIGN_ICONS } from './designIcons';

/**
 * Иконка вкладки «Дизайн»: `<DesignIcon name="zoomIn" />` (набор — `designIcons.ts`).
 *
 * Поведение — как у иконки ERP (её из `design/**` импортировать нельзя):
 * по умолчанию декоративная (`aria-hidden`), подпись даёт текст кнопки или её
 * `aria-label`. Иконка одна и несёт смысл — передайте `title`: svg получает
 * `role="img"` и доступное имя. Неизвестное имя — ничего не рисуется.
 */
export function DesignIcon({ name, size = 18, className, title }) {
  const shapes = DESIGN_ICONS[name];
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
