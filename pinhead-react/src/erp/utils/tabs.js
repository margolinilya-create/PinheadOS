/**
 * Клавиатура для вкладок: ←/→ (и Home/End) переводят фокус между `role="tab"`
 * внутри одного `role="tablist"`.
 *
 * Паттерн вкладок ARIA был объявлен наполовину: роли стояли, а панели с ними не
 * связывались, стрелки не работали, и каждая вкладка была отдельной остановкой Tab
 * (в админке — пять, в боковой карточке — семь). Скринридер обещал «вкладка 3 из 5»
 * и не мог сказать, чем она управляет.
 *
 * Используется вместе с roving tabindex: активная вкладка `tabIndex={0}`,
 * остальные `tabIndex={-1}` — тогда Tab проскакивает набор целиком, как и положено.
 */
const KEYS = { ArrowLeft: -1, ArrowRight: 1 };

export function onTabListKeyDown(e) {
  const list = e.currentTarget.querySelectorAll('[role="tab"]:not([disabled])');
  if (list.length === 0) return;
  const items = [...list];
  const current = items.indexOf(document.activeElement);

  let next = null;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = items.length - 1;
  else if (KEYS[e.key] != null && current >= 0) {
    next = (current + KEYS[e.key] + items.length) % items.length;
  }
  if (next == null) return;

  e.preventDefault();
  items[next].focus();
  // Вкладки здесь активируются самим фокусом (automatic activation) — так же,
  // как по клику: у всех наборов переключение мгновенное и без побочных эффектов.
  items[next].click();
}
