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
      //
      // Наблюдаем ВСЕ элементы-дети, а не только первого: ширину строки
      // набирают все, и подмена шрифта у пятой вкладки меняет `scrollWidth`
      // ровно так же, как у первой.
      for (const child of el.children) ro.observe(child);
    } else {
      window.addEventListener('resize', update);
    }
    /**
     * ПЕРЕСЧЁТ ПОСЛЕ ЗАГРУЗКИ ШРИФТОВ — обязателен, а не «на всякий случай».
     *
     * У всех начертаний проекта `font-display: swap`: первый кадр рисуется
     * запасным шрифтом, настоящий приезжает позже и МЕНЯЕТ ШИРИНУ ТЕКСТА.
     * Замер, сделанный до подмены, отвечает на вопрос «есть ли что
     * прокручивать» про другую строку — и остаётся таким навсегда, если
     * наблюдатель размеров не сработал.
     *
     * Видно это было на холодной загрузке (первый визит цехового планшета —
     * то есть каждое утро смены) и на прогоне CI: там ряд вкладок цехов
     * считал себя непрокручиваемым при обрезанной седьмой вкладке, а локально,
     * со шрифтами в кеше, подсказка появлялась. Снимок расходился на 177
     * пикселей ровно в этом месте — и это была не гонка эффекта, а замер
     * по запасному шрифту.
     */
    let alive = true;
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts?.ready?.then) fonts.ready.then(() => { if (alive) update(); }).catch(() => {});
    return () => {
      alive = false;
      el.removeEventListener('scroll', update);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [update]);

  return { ref, hints, update };
}
