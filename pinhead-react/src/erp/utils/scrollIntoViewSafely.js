/**
 * Прокрутка к элементу с уважением к `prefers-reduced-motion`.
 *
 * CSS-блок `@media (prefers-reduced-motion: reduce)` в `styles/utils.css`
 * гасит `animation` и `transition`, но JS-прокрутку он не видит ПО ПОСТРОЕНИЮ:
 * `behavior: 'smooth'` — это аргумент вызова, а не свойство стиля. Для человека,
 * которому плавное движение противопоказано (вестибулярные расстройства,
 * WCAG 2.3.3), автоскролл к ошибке формы или к виджету уведомлений оставался
 * анимированным.
 */
export function scrollIntoViewSafely(el, options = {}) {
  if (!el) return;
  const reduce = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ ...options, behavior: reduce ? 'auto' : 'smooth' });
}
