import { useSyncExternalStore } from 'react';

/**
 * Реактивный matchMedia без зависимостей: true, когда media query совпадает.
 * Безопасен в jsdom (нет matchMedia → всегда false).
 *
 *   const isMobile = useMediaQuery('(max-width: 760px)');
 */
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}
