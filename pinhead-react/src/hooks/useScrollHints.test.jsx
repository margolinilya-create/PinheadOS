import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useScrollHints } from './useScrollHints';

/**
 * Подсказка прокрутки обязана быть в ПЕРВОМ отрисованном кадре.
 *
 * ЧТО СЛОМАЛОСЬ. Замер стоял в `useEffect`, то есть ПОСЛЕ отрисовки: первый
 * кадр рисовался без градиента, следующий — с ним. Дефект прожил незамеченным,
 * потому что ни один функциональный тест кадров не считает. Поймал его
 * визуальный эталон очереди цеха: CI снял полосу вкладок БЕЗ градиента,
 * локальный прогон — С ним, и снимки разошлись на 177 пикселей ровно в этом
 * месте. То есть это была ещё и ГОНКА — результат зависел от того, успел ли
 * эффект до захвата экрана.
 *
 * ПОЧЕМУ ТЕСТ НАПИСАН ТАК, А НЕ ЧЕРЕЗ `render()` ИЗ TESTING LIBRARY.
 * Первая редакция этого сторожа была фиктивной: `render()` оборачивает
 * отрисовку в `act()`, а тот прогоняет И пассивные эффекты, — возврат замера
 * в `useEffect` она проходила зелёной. Здесь корень монтируется вручную
 * внутри `flushSync`: он доводит до конца синхронную часть коммита, то есть
 * ровно ту, в которой работают `useLayoutEffect` и вызванные из них правки
 * состояния. Пассивные эффекты в неё не попадают по построению — значит
 * содержимое DOM сразу после `flushSync` и есть «первый кадр».
 *
 * Проверено мутацией: с `useEffect` первый тест краснеет.
 */

/** Корень монтируется без `act()`: он-то и прогонял пассивные эффекты */
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

function Probe({ scrollWidth, clientWidth, scrollLeft = 0 }) {
  const { ref, hints } = useScrollHints();
  return (
    <div
      ref={(el) => {
        if (!el) return;
        // jsdom лейаут не считает — величины задаём сами. Именно они
        // единственный вход правила «есть ли что прокручивать».
        Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
        Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
        Object.defineProperty(el, 'scrollLeft', { value: scrollLeft, configurable: true });
        ref.current = el;
      }}
    >
      <span>содержимое</span>
      <span data-testid="right">{hints.right ? 'есть' : 'нет'}</span>
      <span data-testid="left">{hints.left ? 'есть' : 'нет'}</span>
    </div>
  );
}

let host;
let root;

/** Первый кадр: монтируем и НЕ даём прогнаться пассивным эффектам */
function firstFrame(ui) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root.render(ui));
  return {
    right: host.querySelector('[data-testid="right"]').textContent,
    left: host.querySelector('[data-testid="left"]').textContent,
  };
}

afterEach(() => {
  flushSync(() => root?.unmount());
  host?.remove();
});

describe('useScrollHints — подсказка видна с первого кадра', () => {
  it('содержимое шире контейнера — градиент справа уже в первом кадре', () => {
    expect(firstFrame(<Probe scrollWidth={800} clientWidth={375} />).right).toBe('есть');
  });

  it('прокручено вправо — подсказка слева тоже без второго кадра', () => {
    expect(firstFrame(<Probe scrollWidth={800} clientWidth={375} scrollLeft={120} />).left)
      .toBe('есть');
  });

  it('содержимое помещается — подсказки нет (и лишней остановки табуляции тоже)', () => {
    expect(firstFrame(<Probe scrollWidth={375} clientWidth={375} />).right).toBe('нет');
  });

  it('переполнение в пределах допуска 2px подсказкой не считается', () => {
    // Иначе градиент мигал бы на каждом округлении ширины
    expect(firstFrame(<Probe scrollWidth={376} clientWidth={375} />).right).toBe('нет');
  });

  /**
   * ШРИФТ ПРИЕЗЖАЕТ ПОЗЖЕ ПЕРВОГО КАДРА, И ЭТО МЕНЯЕТ ОТВЕТ.
   *
   * У всех начертаний проекта `font-display: swap`: первый кадр рисуется
   * запасным шрифтом, настоящий подменяет его и меняет ширину текста.
   * Замер, сделанный до подмены, отвечает про другую строку — и остаётся
   * таким навсегда, если наблюдатель размеров не сработал.
   *
   * Так и было: в CI ряд вкладок цехов считал себя непрокручиваемым при
   * обрезанной седьмой вкладке, а локально, со шрифтами в кеше, подсказка
   * появлялась — визуальный эталон расходился на 177 пикселей ровно там.
   */
  it('после загрузки шрифтов подсказка пересчитывается', async () => {
    let resolveFonts;
    const ready = new Promise((r) => { resolveFonts = r; });
    const prev = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true });

    // Первый кадр — запасной шрифт: строка помещается, подсказки нет
    const sizes = { scrollWidth: 375 };
    let el;
    const host2 = document.createElement('div');
    document.body.appendChild(host2);
    const root2 = createRoot(host2);
    function FontProbe() {
      const { ref, hints } = useScrollHints();
      return (
        <div
          ref={(node) => {
            if (!node) return;
            el = node;
            Object.defineProperty(node, 'clientWidth', { value: 375, configurable: true });
            Object.defineProperty(node, 'scrollLeft', { value: 0, configurable: true });
            Object.defineProperty(node, 'scrollWidth', { value: sizes.scrollWidth, configurable: true });
            ref.current = node;
          }}
        >
          <span data-testid="right2">{hints.right ? 'есть' : 'нет'}</span>
        </div>
      );
    }
    flushSync(() => root2.render(<FontProbe />));
    expect(host2.querySelector('[data-testid="right2"]').textContent).toBe('нет');

    // Приехал настоящий шрифт — строка стала шире контейнера
    sizes.scrollWidth = 800;
    Object.defineProperty(el, 'scrollWidth', { value: 800, configurable: true });
    resolveFonts();
    // Ждём МАКРОзадачу: перерисовка от `.then(update)` идёт вне `act()`,
    // и микрозадачи для неё недостаточно
    await new Promise((r) => { setTimeout(r, 0); });
    expect(host2.querySelector('[data-testid="right2"]').textContent).toBe('есть');

    flushSync(() => root2.unmount());
    host2.remove();
    if (prev) Object.defineProperty(document, 'fonts', prev);
    else delete document.fonts;
  });
});
