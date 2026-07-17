import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Подсказки горизонтальной прокрутки: есть ли невидимый контент
 * слева/справа у scroll-контейнера (для градиентов по краям вкладок).
 *
 *   const { ref, hints } = useScrollHints();
 *   <div ref={ref}>…</div>
 *   {hints.right && <div className="fadeR" />}
 */
export function useScrollHints() {
  const ref = useRef(null);
  const [hints, setHints] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setHints((h) => (h.left === left && h.right === right ? h : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      el.removeEventListener('scroll', update);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [update]);

  return { ref, hints, update };
}
