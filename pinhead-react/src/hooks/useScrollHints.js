import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Подсказки горизонтальной прокрутки: есть ли невидимый контент
 * слева/справа у scroll-контейнера (для градиентов по краям вкладок).
 *
 *   const { ref, hints } = useScrollHints();
 *   <div ref={ref}>…</div>
 *   {hints.right && <div className="fadeR" />}
 *
 * ЗАМЕР ИДЁТ В `useLayoutEffect`, а не в `useEffect` (правка 03.09).
 * Обычный эффект выполняется ПОСЛЕ отрисовки: первый кадр рисуется без
 * градиента, второй — с ним. Человек видит это как подмигивание края
 * (та же семья дефектов, что резерв места под поздний `erp_bootstrap`),
 * а визуальный эталон — как гонку: CI поймал полосу вкладок цехов БЕЗ
 * градиента, локальный прогон — С ним, и снимок расходился на 177 пикселей
 * в одном и том же месте, ничего при этом не сломав. Замер до отрисовки
 * делает первый кадр окончательным и снимает обе беды разом.
 *
 * `tabIndex` у `ScrollHintBox` считается из тех же `hints`, то есть
 * прокручиваемая область становится достижимой с клавиатуры сразу,
 * а не через кадр.
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
      // Наблюдаем и за содержимым: у контейнера ширина фиксирована лейаутом, а
      // меняется scrollWidth. Скрыли колонку фильтром или подгрузили строки —
      // размер el прежний, наблюдатель молчит, и подсказка остаётся неверной.
      if (el.firstElementChild) ro.observe(el.firstElementChild);
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
