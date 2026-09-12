import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePullToRefresh, PULL_THRESHOLD } from './usePullToRefresh';

/**
 * Сторож жеста «потянуть — обновить».
 *
 * ⚠️ ЖЕСТ СОБИРАЕТСЯ ИЗ ТРЁХ СОБЫТИЙ, и событие `pointerdown` здесь несёт
 * `pointerType`: хук отвечает ТОЛЬКО пальцу. Забудь его в фикстуре — и все
 * проверки ниже станут зелёными при любой реализации, потому что жест просто
 * не начнётся.
 */
function Host({ onRefresh, withCard = false }) {
  const ref = useRef(null);
  const { pull, armed } = usePullToRefresh(ref, onRefresh);
  return (
    <div ref={ref} data-testid="scroller">
      <span data-testid="state">{armed ? 'armed' : 'idle'}:{Math.round(pull)}</span>
      {withCard && <div draggable="true" data-testid="card">карточка канбана</div>}
    </div>
  );
}

const scroller = () => screen.getByTestId('scroller');

/** Протянуть палец на dy пикселей от точки (x0, y0) вниз. */
function pullBy(el, dy, { target, dx = 0 } = {}) {
  const from = target || el;
  fireEvent.pointerDown(from, { pointerType: 'touch', clientX: 50, clientY: 10 });
  fireEvent.pointerMove(el, { pointerType: 'touch', clientX: 50 + dx, clientY: 10 + dy });
}

afterEach(cleanup);

describe('usePullToRefresh', () => {
  it('протяжка ниже порога не обновляет', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);

    pullBy(scroller(), 40);
    fireEvent.pointerUp(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('протяжка за порог обновляет на отпускании', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);

    // С сопротивлением 1.8 порог берётся примерно с 140 px хода пальца
    pullBy(scroller(), PULL_THRESHOLD * 2 + 20);
    expect(screen.getByTestId('state').textContent).toMatch(/^armed/);

    fireEvent.pointerUp(scroller());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('полоса растёт по ходу пальца', () => {
    render(<Host onRefresh={() => {}} />);
    pullBy(scroller(), 60);
    const [, px] = screen.getByTestId('state').textContent.split(':');
    expect(Number(px)).toBeGreaterThan(0);
  });

  /**
   * СОПРОТИВЛЕНИЕ ОБЯЗАТЕЛЬНО: без него порог берётся случайным движением,
   * и обновление шло бы от любого касания списка.
   */
  it('полоса растёт ЗАМЕТНО медленнее пальца', () => {
    render(<Host onRefresh={() => {}} />);
    pullBy(scroller(), 90);
    const [, px] = screen.getByTestId('state').textContent.split(':');
    /*
     * ⚠️ СРАВНЕНИЕ С САМИМ ХОДОМ (< 90) БЫЛО ВЫРОЖДЕННЫМ: без сопротивления
     * полоса равна 90 − SLOP = 82, то есть тоже меньше 90, и проверка
     * проходила при снятом сопротивлении. Порог выбран между двумя
     * реализациями: с сопротивлением ≈45, без него ≈82.
     */
    expect(Number(px)).toBeLessThan(60);
  });

  /**
   * ДВИЖЕНИЕ ВВЕРХ ЗАКРЫВАЕТ ЖЕСТ, а не просто «не открывает» его. Разница
   * наблюдаема: если жест остаётся живым, то поехавший потом вниз палец
   * добирает порог от ИСХОДНОЙ точки — и список, который человек пролистал
   * вверх и вернул, молча дёргал бы сеть.
   *
   * Первая редакция проверяла только `pullBy(-120)` и была вырожденной:
   * отрицательный ход и так зажимается нулём, поэтому обновления не было
   * ни с гейтом, ни без него.
   */
  it('движение вверх закрывает жест, и обратный ход его не оживляет', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);

    pullBy(scroller(), -120);
    // Тот же жест, палец пошёл вниз и заведомо за порог
    fireEvent.pointerMove(scroller(), { pointerType: 'touch', clientX: 50, clientY: 10 + 300 });
    fireEvent.pointerUp(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  /**
   * ГОРИЗОНТАЛЬ ОТДАЁТСЯ ПРОКРУТКЕ ДОСКИ. Канбан цехов прокручивается
   * по горизонтали, и перехват такого жеста обновлением сделал бы доску
   * неподвижной.
   */
  it('преимущественно горизонтальный жест отдаётся прокрутке', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);
    /*
     * ⚠️ ВЕРТИКАЛЬНЫЙ ХОД ЗДЕСЬ ЗАВЕДОМО ЗА ПОРОГОМ (300 px при пороге 72
     * и сопротивлении 1.8). Первая редакция брала dy = 30: без гейта жест
     * всё равно не добирал порога, и проверка проходила при ЛЮБОЙ
     * реализации. Поймано мутацией — гейт сняли, тест остался зелёным.
     */
    pullBy(scroller(), 300, { dx: 400 });
    fireEvent.pointerUp(scroller());
    expect(onRefresh).not.toHaveBeenCalled();
  });

  /**
   * ЖЕСТ, НАЧАТЫЙ НА ПЕРЕТАСКИВАЕМОЙ КАРТОЧКЕ, — НЕ НАШ. Иначе протяжка
   * конкурировала бы с `useTouchDndPolyfill` (holdToDrag: 300) на доске
   * цехов, и перенос этапа пальцем стал бы ненадёжным.
   */
  it('жест с карточки канбана не перехватывается', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} withCard />);

    pullBy(scroller(), PULL_THRESHOLD * 3, { target: screen.getByTestId('card') });
    fireEvent.pointerUp(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('мышь жест не начинает', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);

    fireEvent.pointerDown(scroller(), { pointerType: 'mouse', clientX: 50, clientY: 10 });
    fireEvent.pointerMove(scroller(), { pointerType: 'mouse', clientX: 50, clientY: 400 });
    fireEvent.pointerUp(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('отмена указателя не обновляет', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);

    pullBy(scroller(), PULL_THRESHOLD * 3);
    expect(screen.getByTestId('state').textContent).toMatch(/^armed/);
    fireEvent.pointerCancel(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  /**
   * СВЕРХУ ЛИ МЫ — ПРОВЕРЯЕТСЯ В НАЧАЛЕ ЖЕСТА. Проверка при движении дала бы
   * «поймать» ноль посреди инерционной прокрутки: список доехал до верха,
   * палец ещё едет вниз — и пошло бы обновление, которого никто не просил.
   */
  it('из середины списка жест не начинается', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);
    // jsdom раскладки не считает, поэтому прокрутка задаётся прямо
    scroller().scrollTop = 250;

    pullBy(scroller(), PULL_THRESHOLD * 3);
    fireEvent.pointerUp(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  /**
   * ПЕРЕДУМАТЬ МОЖНО — и это осознанное расхождение с `SlideConfirm`, где
   * коммит происходит НА ПОРОГЕ.
   *
   * У протяжки подтверждения порог это защита: довести И отпустить дало бы
   * два способа не сработать там, где человек уже решился. Здесь наоборот —
   * порог легко перейти случайно, пролистывая список сверху, и сетевое
   * действие, которого не просили, хуже лишней десятой доли секунды.
   */
  it('дотянул за порог, вернул палец вверх и отпустил — обновления нет', () => {
    const onRefresh = vi.fn();
    render(<Host onRefresh={onRefresh} />);

    pullBy(scroller(), PULL_THRESHOLD * 3);
    expect(screen.getByTestId('state').textContent, 'порог обязан быть взят').toMatch(/^armed/);

    // Тот же жест, палец поехал обратно вверх
    fireEvent.pointerMove(scroller(), { pointerType: 'touch', clientX: 50, clientY: 10 });
    fireEvent.pointerUp(scroller());

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('полоса обнуляется после жеста', () => {
    render(<Host onRefresh={() => {}} />);
    pullBy(scroller(), 60);
    fireEvent.pointerUp(scroller());
    expect(screen.getByTestId('state').textContent).toBe('idle:0');
  });
});
