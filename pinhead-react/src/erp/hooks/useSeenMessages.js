import { useCallback, useEffect, useRef } from 'react';

/**
 * ПРОЧИТАНО — ЭТО «ПОКАЗАЛОСЬ НА ГЛАЗА» (правка заказчика 20.09, п. 4).
 *
 * Документ формулирует условие целиком: «автоматически считать сообщение
 * прочитанным, когда оно ДЕЙСТВИТЕЛЬНО ПОПАЛО В ВИДИМУЮ ОБЛАСТЬ открытого
 * чата ПРИ АКТИВНОМ ОКНЕ БРАУЗЕРА. Открытие заказа, уведомления или фоновой
 * вкладки само по себе не означает прочтение».
 *
 * Отсюда три условия, и все три обязательны:
 *   1. элемент пересёк видимую область ленты — `IntersectionObserver`;
 *   2. вкладка на переднем плане — `document.visibilityState`;
 *   3. окно в фокусе — вкладка бывает видимой в соседнем окне поверх которого
 *      работают в другом приложении.
 *
 * ОТПРАВЛЯЕТСЯ ПАЧКОЙ. Прокрутка показывает десяток сообщений за секунду,
 * и запрос на каждое превратил бы чтение переписки в поток запросов
 * с цехового планшета. Накопленное уходит одним вызовом с задержкой.
 *
 * Задержка КОПИТ, а не фильтрует: сообщение, мелькнувшее при быстрой
 * прокрутке, тоже засчитывается. Различать «увидел» и «прочитал» документ
 * не просит, а любая попытка — таймер на элемент, порог видимости
 * по времени — это догадка о человеке, которую нечем проверить.
 */

/** Сколько копим перед отправкой */
const FLUSH_MS = 800;

/**
 * @param {(ids: string[]) => Promise<unknown>} onSeen — отправитель пачки
 * @param {boolean} enabled — есть ли смысл наблюдать (окно чата открыто)
 */
export function useSeenMessages(onSeen, enabled = true) {
  /** Корень наблюдения — лента; выставляется рефом из компонента */
  const rootRef = useRef(null);
  const observerRef = useRef(null);
  const pending = useRef(new Set());
  const timer = useRef(null);
  /** Уже отправленные — второй раз не шлём даже при возврате прокруткой */
  const sent = useRef(new Set());

  const flush = useCallback(() => {
    timer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    if (ids.length === 0) return;
    for (const id of ids) sent.current.add(id);
    void onSeen(ids);
  }, [onSeen]);

  const schedule = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  /** Активно ли окно: видимая вкладка И фокус */
  const windowActive = () => typeof document === 'undefined'
    || (document.visibilityState === 'visible' && document.hasFocus());

  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver((entries) => {
      if (!windowActive()) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = entry.target.dataset?.messageId;
        if (!id || sent.current.has(id)) continue;
        pending.current.add(id);
      }
      if (pending.current.size > 0) schedule();
    }, {
      root: rootRef.current ?? null,
      // Половина элемента — достаточное «попало в видимую область»:
      // требовать целиком значит не засчитывать длинные сообщения вовсе
      threshold: 0.5,
    });

    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [enabled, schedule]);

  /**
   * Вернулись на вкладку — то, что уже на экране, становится прочитанным.
   * Без этого сообщения, пришедшие в фоне и оставшиеся в видимой области,
   * висели бы непрочитанными, пока человек не прокрутит ленту.
   */
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;
    const onWake = () => {
      if (!windowActive()) return;
      const observer = observerRef.current;
      const root = rootRef.current;
      if (!observer || !root) return;
      // Перенаблюдение заставляет наблюдатель заново сообщить о видимых
      for (const node of root.querySelectorAll('[data-message-id]')) {
        observer.unobserve(node);
        observer.observe(node);
      }
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [enabled]);

  /** Корень наблюдения — лента. Ставится callback-ref'ом из компонента */
  const setRoot = useCallback((node) => { rootRef.current = node; }, []);

  /** Реф на элемент сообщения: вешается на каждый пузырь ленты */
  const observe = useCallback((node) => {
    const observer = observerRef.current;
    if (!node || !observer) return;
    observer.observe(node);
  }, []);

  return { setRoot, observe };
}
