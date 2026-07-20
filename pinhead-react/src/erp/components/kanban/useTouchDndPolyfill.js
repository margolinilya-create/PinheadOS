import { useEffect } from 'react';

let dndPolyfillLoaded = false;

/**
 * Ленивая инициализация mobile-drag-drop только на тач-устройствах.
 * HTML5 DnD не работает на touch — на pointer:coarse лениво подгружается
 * полифилл (~10KB), десктоп его не грузит.
 */
export function useTouchDndPolyfill() {
  useEffect(() => {
    if (dndPolyfillLoaded) return;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    dndPolyfillLoaded = true;
    Promise.all([
      import('mobile-drag-drop'),
      import('mobile-drag-drop/scroll-behaviour'),
      import('mobile-drag-drop/default.css'),
    ]).then(([{ polyfill }, { scrollBehaviourDragImageTranslateOverride }]) => {
      const applied = polyfill({
        // прокрутка страницы во время drag у края экрана
        dragImageTranslateOverride: scrollBehaviourDragImageTranslateOverride,
        // удержание 300мс перед drag — обычный тап/скролл не конфликтует
        holdToDrag: 300,
        dragImageCenterOnTouch: true,
      });
      if (applied) {
        // iOS Safari: без «неленивого» touchmove-слушателя drag не стартует
        // (opt-in из README пакета — usePassiveEventListeners workaround)
        window.addEventListener('touchmove', () => {}, { passive: false });
      }
    }).catch(() => {
      dndPolyfillLoaded = false; // сеть моргнула — попробуем при следующем монтировании
    });
  }, []);
}
