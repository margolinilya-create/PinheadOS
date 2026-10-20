import { useEffect, useRef } from 'react';

/** Префикс ключа в sessionStorage: позиция живёт до закрытия вкладки, как и история «назад» */
const PREFIX = 'erp:list-scroll:';

/**
 * Прокручивается не окно, а `main#main-content` оболочки ERP (`.main` —
 * `overflow-y: auto`). Без него (тесты, чужая оболочка) — документ.
 */
function scroller() {
  return document.getElementById('main-content') ?? document.scrollingElement;
}

/** Хранилище бывает закрыто (приватный режим, запрет сайта) — позиция тогда просто не помнится */
function read(key) {
  try {
    const n = Number.parseInt(sessionStorage.getItem(PREFIX + key) ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function write(key, top) {
  try {
    sessionStorage.setItem(PREFIX + key, String(Math.round(top)));
  } catch {
    // Не помним — не беда: список откроется сверху
  }
}

/**
 * ВОЗВРАТ К СПИСКУ СОХРАНЯЕТ ПОЛОЖЕНИЕ ПРОКРУТКИ (правки 19.10, п. 7:
 * «Возврат к списку сохраняет фильтры и положение прокрутки»).
 *
 * Фильтры живут в адресе (`useListParams`), а прокрутка — здесь: позиция
 * пишется на каждую прокрутку (кадром, а не событием) и при уходе с экрана,
 * а при новом монтировании возвращается — ОДИН раз и только когда список
 * готов (`ready`): прокрутить пустой экран со скелетоном значит упереться
 * в ноль и потерять позицию.
 *
 * @param key    имя списка; разные списки — разные позиции
 * @param ready  строки уже отрисованы
 */
export function useListScroll(key, ready = true) {
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const top = read(key);
    const el = scroller();
    if (top > 0 && el) el.scrollTop = top;
  }, [key, ready]);

  useEffect(() => {
    const el = scroller();
    if (!el) return undefined;
    let frame = 0;
    // До возврата позиции не пишем: прокрутка пустого экрана затёрла бы сохранённую
    const save = () => { if (restored.current) write(key, el.scrollTop); };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; save(); });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
      // Последняя позиция — при уходе: кадр с записью мог не успеть
      save();
    };
  }, [key]);
}
