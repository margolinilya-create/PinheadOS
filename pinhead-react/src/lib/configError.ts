/**
 * Экран «приложение не настроено».
 *
 * Зачем он вообще нужен. `lib/supabase.ts` проверяет переменные окружения
 * на уровне МОДУЛЯ — то есть до того, как выполнится хоть одна строка
 * `main.jsx` и смонтируется React. Значит:
 *   · ErrorBoundary не сработает — его ещё нет;
 *   · тост не покажется — стора ещё нет;
 *   · `#root` останется пустым, и человек увидит белый экран.
 *
 * Белый экран не сообщает НИЧЕГО. В проде это выглядит как «сайт лежит»,
 * хотя лежит одна переменная в настройках деплоя; в разработке это стоило
 * получаса на выяснение, почему все 13 e2e-сценариев подряд сообщают
 * «element(s) not found» — падал импорт, а не разметка.
 *
 * Поэтому: сначала рисуем читаемое сообщение, потом бросаем. Бросать
 * по-прежнему обязательно — без ключей приложение неработоспособно,
 * и молча продолжать с `createClient(undefined, undefined)` значит
 * получить ту же ошибку позже и в менее понятном месте.
 */

/** Разметка экрана. Отдельно от вставки в DOM — чтобы её можно было проверить тестом. */
export function configErrorHtml(title: string, detail: string, hint: string): string {
  return [
    '<div role="alert" style="',
    'min-height:100dvh;display:flex;align-items:center;justify-content:center;',
    'padding:24px;font-family:Inter,system-ui,sans-serif;background:#FAFAFA;color:#0A0A0A',
    '">',
    '<div style="max-width:520px">',
    `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(detail)}</p>`,
    `<p style="margin:0;line-height:1.6;color:#666666;font-size:14px">${escapeHtml(hint)}</p>`,
    '</div></div>',
  ].join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Рисует экран в `#root`, если он есть. Тихо ничего не делает вне браузера
 * (тесты, SSR) — падать в обработчике ошибки нельзя, иначе исходная причина
 * потеряется за вторичной.
 */
export function renderConfigError(title: string, detail: string, hint: string): void {
  try {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('root');
    if (!root) return;
    root.innerHTML = configErrorHtml(title, detail, hint);
  } catch {
    // намеренно пусто: см. комментарий выше
  }
}
