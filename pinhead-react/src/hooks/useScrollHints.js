import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Подсказки горизонтальной прокрутки: есть ли невидимый контент
 * слева/справа у scroll-контейнера (для градиентов по краям вкладок).
 *
 *   const { ref, hints } = useScrollHints();
 *   <div ref={ref}>…</div>
 *   {hints.right && <div className="fadeR" />}
 *
 * ЭЛЕМЕНТ МОЖЕТ ПОЯВИТЬСЯ ПОЗЖЕ, И ЭТО НЕ РЕДКИЙ СЛУЧАЙ (правка 03.09).
 * Раньше `ref` был обычным `useRef`, а эффект стоял на пустых зависимостях:
 * если в момент монтирования прокручиваемого блока ещё нет — а ряда вкладок
 * цехов нет, пока не приехал `erp_bootstrap`, — эффект выходил на первой же
 * строке (`ref.current === null`), и повторно не запускался НИКОГДА. Ни
 * замера, ни слушателя прокрутки, ни наблюдателя размеров: подсказка
 * не появлялась вовсе, а вместе с ней и `tabIndex` у `ScrollHintBox`, то есть
 * область оставалась недостижимой с клавиатуры (WCAG 2.1.1).
 *
 * Видно это было на ХОЛОДНОЙ загрузке — первый визит цехового планшета, то
 * есть каждое утро смены, — и потому не воспроизводилось локально, где мок
 * отвечает раньше первой отрисовки. Поймал прогон CI: ряд вкладок
 * с `scrollWidth 722` при `clientWidth 353` (то есть переполненный) рисовался
 * без градиента, и визуальный эталон расходился на 177 пикселей ровно там.
 *
 * Поэтому `ref` — функция-колбэк: React зовёт её, когда узел появляется
 * и когда исчезает, и хук перезапускает замер. Свойство `.current` у неё
 * сохранено — потребители читают его напрямую (`DepartmentQueue` ищет
 * активную вкладку, чтобы прокрутить её в видимую область).
 */
/** Одна и та же ссылка: потребители кладут `hints` в зависимости эффектов */
const NO_HINTS = { left: false, right: false };

export function useScrollHints() {
  const [node, setNode] = useState(null);
  const nodeRef = useRef(null);
  const [hints, setHints] = useState({ left: false, right: false });

  /**
   * Колбэк-ref, который ещё и притворяется объектом-ref: у него есть `.current`.
   * Создаётся один раз ленивым инициализатором состояния — не `useRef`:
   * читать `ref.current` во время отрисовки правила компилятора запрещают,
   * и справедливо.
   */
  const [ref] = useState(() => {
    const attach = (el) => {
      nodeRef.current = el ?? null;
      attach.current = el ?? null;
      setNode(el ?? null);
    };
    attach.current = null;
    return attach;
  });

  const update = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setHints((h) => (h.left === left && h.right === right ? h : { left, right }));
  }, []);

  /**
   * ЗАМЕР ИДЁТ В `useLayoutEffect`, а не в `useEffect`. Обычный эффект
   * выполняется ПОСЛЕ отрисовки: первый кадр рисуется без градиента, второй —
   * с ним, и человек видит подмигивание края.
   */
  useLayoutEffect(() => {
    const el = node;
    if (!el) return undefined;
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
     * ДЕТИ ПОЯВЛЯЮТСЯ ПОЗЖЕ — и наблюдатель размеров об этом не узнает.
     *
     * Ряд вкладок цехов существует с первого кадра, но ПУСТОЙ: сами вкладки
     * приезжают с `erp_bootstrap`. Ширина самого ряда при этом не меняется
     * (он и так во всю строку), меняется `scrollWidth` — а `ResizeObserver`
     * следит за элементами, а не за содержимым, и подписан он был только
     * на тех детей, что существовали в момент замера, то есть ни на кого.
     * Подсказка не появлялась НИКОГДА, вместе с ней и `tabIndex`
     * у `ScrollHintBox` (WCAG 2.1.1).
     *
     * Локально это не воспроизводилось: мок отвечает раньше первой отрисовки.
     * Поймал прогон CI — ряд с `scrollWidth 722` при `clientWidth 353`
     * рисовался без градиента, и визуальный эталон расходился на 177 пикселей.
     */
    let mo;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver(() => {
        if (ro) for (const child of el.children) ro.observe(child);
        update();
      });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
    }
    /**
     * Пересчёт после загрузки шрифтов: у всех начертаний проекта
     * `font-display: swap`, первый кадр рисуется запасным шрифтом, настоящий
     * приезжает позже и меняет ширину текста. Замер, сделанный до подмены,
     * отвечает про другую строку.
     */
    let alive = true;
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts?.ready?.then) fonts.ready.then(() => { if (alive) update(); }).catch(() => {});
    return () => {
      alive = false;
      el.removeEventListener('scroll', update);
      if (mo) mo.disconnect();
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [node, update]);

  /*
   * Узла нет — подсказок нет, и это ВЫВОДИТСЯ, а не хранится: запись «сбросить»
   * внутри эффекта — это лишний каскад перерисовок (и её справедливо ловит
   * правило компилятора React). Иначе исчезнувший блок оставил бы висеть
   * градиент от прошлого экрана.
   */
  return { ref, hints: node ? hints : NO_HINTS, update };
}
