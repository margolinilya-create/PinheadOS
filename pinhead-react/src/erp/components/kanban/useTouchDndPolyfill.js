import { useEffect } from 'react';

let dndPolyfillLoaded = false;

/**
 * Ленивая инициализация mobile-drag-drop только на тач-устройствах.
 * HTML5 DnD не работает на touch — на pointer:coarse лениво подгружается
 * полифилл (~10KB), десктоп его не грузит.
 *
 * Прокрутку страницы во время перетаскивания намеренно НЕ включаем
 * (правка 4: «не допускать случайной прокрутки экрана во время drag-and-drop»).
 * У края доски скроллится сама доска — ErpKanban.onBoardDragOver.
 */
export function useTouchDndPolyfill() {
  useEffect(() => {
    if (dndPolyfillLoaded) return;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    dndPolyfillLoaded = true;
    Promise.all([
      import('mobile-drag-drop'),
      import('mobile-drag-drop/default.css'),
    ]).then(([{ polyfill }]) => {
      const applied = polyfill({
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
