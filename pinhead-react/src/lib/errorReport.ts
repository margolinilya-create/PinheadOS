/**
 * Отправка ошибок наружу (C7 аудита: «наблюдаемости нет»).
 *
 * Было: `ErrorBoundary` писал `console.error` в браузер пользователя. О белом
 * экране в цеху узнавали по телефону, через часы, без возможности воспроизвести.
 * Vercel Runtime Errors тут не помогают физически — приложение статическое,
 * серверного рантайма нет, и ошибка в React-компоненте туда не попадает.
 *
 * Почему без SDK. Sentry — это новая зависимость, а правило проекта требует
 * обсуждать их отдельно; плюс DSN всё равно нужен из чужого аккаунта. Здесь
 * ровно то, ради чего SDK и ставят: сообщение, стек, адрес экрана и версия
 * сборки уходят на настраиваемый приёмник. Подойдёт что угодно, принимающее
 * POST с JSON, — Sentry Store API, Logflare, вебхук. Захотите полноценный SDK
 * (сессии, трассировки, релизы) — эта точка станет местом его подключения.
 *
 * Адрес приёмника — из `.env` (`VITE_ERROR_REPORT_URL`), как и ключи Supabase.
 * Без него модуль НИЧЕГО не делает: неподнятая наблюдаемость не должна ни
 * ломать сборку, ни слать запросы в никуда с цехового планшета.
 */

/** Куда слать. Пусто — отправка выключена */
const ENDPOINT = import.meta.env?.VITE_ERROR_REPORT_URL ?? '';

/** Сколько отчётов за сессию максимум — цикл рендера не должен забить сеть */
export const MAX_REPORTS = 20;

/** Одинаковые ошибки не шлём повторно: один сломанный рендер даёт их сотнями */
const seen = new Set<string>();
let sent = 0;

export interface ErrorReport {
  message: string;
  stack?: string;
  /** Где случилось: «render», «window», «promise» + компонент, если известен */
  source: string;
  url: string;
  at: string;
  release?: string;
  userAgent?: string;
}

/** Ключ для дедупликации: сообщение + первая строка стека */
function keyOf(message: string, stack?: string): string {
  return `${message}::${(stack ?? '').split('\n')[1]?.trim() ?? ''}`;
}

export function buildReport(
  error: unknown,
  source: string,
  extra?: string,
): ErrorReport {
  const err = error instanceof Error ? error : null;
  const message = err?.message || String(error ?? 'unknown error');
  return {
    message: message.slice(0, 500),
    stack: [err?.stack, extra].filter(Boolean).join('\n').slice(0, 4000) || undefined,
    source,
    url: typeof location !== 'undefined' ? location.href : '',
    at: new Date().toISOString(),
    release: import.meta.env?.VITE_RELEASE || undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  };
}

/**
 * Отправить отчёт. Возвращает `true`, если запрос ушёл.
 *
 * Никогда не бросает и ничего не ждёт: отчёт об ошибке, роняющий приложение
 * повторно, — худший вид наблюдаемости. `sendBeacon` переживает закрытие
 * вкладки, а это как раз момент, когда пользователь уходит со сломанного экрана.
 */
export function reportError(error: unknown, source: string, extra?: string): boolean {
  try {
    if (!ENDPOINT) return false;
    const report = buildReport(error, source, extra);
    const key = keyOf(report.message, report.stack);
    if (seen.has(key) || sent >= MAX_REPORTS) return false;
    seen.add(key);
    sent += 1;

    const body = JSON.stringify(report);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      return navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/** Сброс счётчиков — только для тестов */
export function _resetReports(): void {
  seen.clear();
  sent = 0;
}

/**
 * Ошибки вне React: они не доходят до `ErrorBoundary` вообще.
 * Сюда попадают падения в обработчиках событий и таймерах — то есть часть того,
 * что ломает цеховой планшет.
 *
 * `unhandledrejection` здесь НЕ вешается: свой обработчик стоит в `main.jsx`
 * (он ещё и показывает тост) и сам зовёт `reportError`. Второй слушатель дал бы
 * два отчёта на одну ошибку — дедупликация их погасит, но полагаться на неё
 * ради того, чего можно просто не делать, незачем.
 */
export function installGlobalErrorReporting(): void {
  if (typeof window === 'undefined' || !ENDPOINT) return;
  window.addEventListener('error', (e) => {
    reportError(e.error ?? e.message, 'window');
  });
}
