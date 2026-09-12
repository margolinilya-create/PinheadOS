import { useEffect, useRef, useState } from 'react';

/** Сколько пикселей надо протянуть, чтобы обновление пошло. */
export const PULL_THRESHOLD = 72;

/**
 * Сопротивление: палец прошёл X — полоса выросла на X / RESISTANCE.
 * Без него порог берётся случайным движением, с ним тянуть надо намеренно.
 */
const RESISTANCE = 1.8;

/** Минимальный сдвиг, на котором решаем «это вертикальный жест, а не дрожь». */
const SLOP = 8;

/**
 * ПОТЯНУТЬ СВЕРХУ — ОБНОВИТЬ. Жест, который на планшете пробуют первым.
 *
 * Приём с bencho.dev (блок `Pull to refresh`); взята у него главная мысль,
 * сформулированная там же: «обязательство случается НА ПОРОГЕ». Доехал
 * до порога — обновление пошло, и палец больше не нужен; инерции и
 * «доводки» нет вовсе.
 *
 * ЗАЧЕМ. Планшет в цеху держат открытым сутками на одном экране. Авто-
 * пересинхронизация висит на `visibilitychange`/`online`/`focus`, то есть
 * срабатывает, когда вкладка ПЕРЕКЛЮЧАЛАСЬ, — а она не переключается.
 * Ручного способа обновить данные на этих экранах не было ни одного:
 * оставалось F5, то есть перезагрузка приложения вместо перечитывания данных.
 *
 * ─── ЖЕСТ РАЗВЕДЁН С ПЕРЕТАСКИВАНИЕМ, А НЕ ОТОБРАН У НЕГО ─────────────────
 * На доске цехов карточки канбана таскают пальцем (`useTouchDndPolyfill`,
 * `holdToDrag: 300`). Разводятся они тремя условиями, и все три обязательны:
 *   1. жест начался на `[draggable="true"]` — это перетаскивание, не наше;
 *   2. горизонтальный сдвиг обогнал вертикальный — это прокрутка доски;
 *   3. контейнер не в самом верху — тянуть нечего, идёт обычная прокрутка.
 * Исключать экраны целиком не потребовалось: признаки точные.
 *
 * ─── ТОЛЬКО ПАЛЕЦ ─────────────────────────────────────────────────────────
 * `pointerType === 'touch'`. Мышью это движение никто не делает, а случайное
 * протягивание с зажатой кнопкой не должно дёргать сеть.
 */
export function usePullToRefresh(ref, onRefresh, { enabled = true } = {}) {
  /** Насколько вытянута полоса, px. 0 — жеста нет. */
  const [pull, setPull] = useState(0);
  const state = useRef(null);
  /**
   * Колбэк в ref: иначе эффект переподписывался бы на каждый рендер, стоило
   * вызывающему передать стрелку по месту.
   *
   * ⚠️ ЗАПИСЬ — В ЭФФЕКТЕ, А НЕ В ТЕЛЕ. Присваивание `fn.current` во время
   * рендера запрещено правилом `react-hooks/refs` и запрещено по делу:
   * рендер может быть отброшен (StrictMode, прерванный рендер), и ref остался
   * бы с колбэком, которого в дереве нет.
   */
  const fn = useRef(onRefresh);
  useEffect(() => { fn.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return undefined;

    const end = (commit) => {
      const s = state.current;
      state.current = null;
      setPull(0);
      if (commit && s && s.distance >= PULL_THRESHOLD) fn.current();
    };

    const onDown = (e) => {
      if (e.pointerType !== 'touch') return;
      // Сверху ли мы — проверяется В НАЧАЛЕ жеста: проверка при движении
      // позволила бы «поймать» верх посреди инерционной прокрутки.
      if (el.scrollTop > 0) return;
      if (e.target.closest?.('[draggable="true"]')) return;
      state.current = { y: e.clientY, x: e.clientX, distance: 0, decided: false };
    };

    const onMove = (e) => {
      const s = state.current;
      if (!s) return;
      const dy = e.clientY - s.y;
      const dx = e.clientX - s.x;

      if (!s.decided) {
        if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
        // Горизонталь — это прокрутка доски цехов, отдаём жест ей
        if (Math.abs(dx) > Math.abs(dy)) { end(false); return; }
        // Вверх — обычная прокрутка содержимого
        if (dy <= 0) { end(false); return; }
        s.decided = true;
      }

      // Человек передумал и повёл вверх — полоса уезжает, жест не отменяется
      s.distance = Math.max((dy - SLOP) / RESISTANCE, 0);
      setPull(s.distance);
    };

    /**
     * Обработчики ИМЕНОВАНЫ, а не переданы стрелками по месту. `remove`
     * сверяет ссылку на функцию, и анонимная стрелка не снимается НИКОГДА:
     * каждое переподключение эффекта добавляло бы ещё по три слушателя
     * на тот же узел, и через несколько переходов одно отпускание пальца
     * вызывало бы обновление пачкой.
     */
    const onUp = () => end(true);
    const onCancel = () => end(false);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    // Уход указателя со страницы — тот же отказ: `pointerup` уже не придёт
    el.addEventListener('pointerleave', onCancel);

    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('pointerleave', onCancel);
      state.current = null;
    };
  }, [ref, enabled]);

  return { pull, armed: pull >= PULL_THRESHOLD };
}
