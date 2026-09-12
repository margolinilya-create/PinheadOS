import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { NumberStepper } from './NumberStepper';
import { HOLD_MS } from '../utils/stepperSweep';

/**
 * Сторож числового степпера.
 *
 * ⚠️ ВРЕМЯ И КАДРЫ ПОДМЕНЯЮТСЯ ОБА. Свип живёт на `setTimeout` (порог
 * удержания) плюс `requestAnimationFrame` (сам цикл), а сколько шагов положено
 * — считается от `performance.now()`. Подменишь только таймеры — цикл
 * запустится, но время внутри него не двинется, и сторож покажет ноль шагов
 * на работающем свипе, то есть будет зелен на сломанном коде.
 */
function fake() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
  });
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const plus = () => screen.getByRole('button', { name: 'Увеличить' });
const minus = () => screen.getByRole('button', { name: 'Уменьшить' });

describe('NumberStepper — тап', () => {
  it('один тап даёт один шаг, и СРАЗУ, на нажатии', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="5" onChange={onChange} />);

    fireEvent.pointerDown(plus());

    // Именно на pointerDown: кнопка, отвечающая только на отпускание,
    // читается как несработавшая (жалоба цеха 30.08 про «Взять в работу»)
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('6');
  });

  it('отпускание после тапа не добавляет второго шага', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="5" onChange={onChange} />);

    fireEvent.pointerDown(plus());
    fireEvent.pointerUp(plus());

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('минус идёт в другую сторону', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="5" onChange={onChange} />);
    fireEvent.pointerDown(minus());
    expect(onChange).toHaveBeenLastCalledWith('4');
  });

  it('шаг считается от min, когда поле пусто', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="" onChange={onChange} min={0} />);
    fireEvent.pointerDown(plus());
    expect(onChange).toHaveBeenLastCalledWith('1');
  });

  /**
   * ПУСТОЕ ПОЛЕ ОСТАЁТСЯ ПУСТЫМ, пока человек не тронул кнопку. Правило
   * проекта: поле факта («сколько сдано», «сделано за день») стоит пустым,
   * а не предзаполненным, чтобы один тап не закрыл тираж целиком.
   */
  it('пустое значение рисуется пустым, а не нулём', () => {
    render(<NumberStepper value="" onChange={() => {}} ariaLabel="Принято" />);
    expect(screen.getByLabelText('Принято')).toHaveValue(null);
  });

  it('набор текста проходит как есть — строкой, как у нативного поля', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="" onChange={onChange} ariaLabel="Принято" />);
    fireEvent.change(screen.getByLabelText('Принято'), { target: { value: '47' } });
    expect(onChange).toHaveBeenLastCalledWith('47');
  });
});

describe('NumberStepper — удержание', () => {
  it('удержание добирает шаги, тап — нет', () => {
    const onChange = vi.fn();
    fake();
    render(<NumberStepper value="0" onChange={onChange} max={999} />);

    fireEvent.pointerDown(plus());
    expect(onChange).toHaveBeenCalledTimes(1);

    // Порог ещё не прошёл — свип не начался
    vi.advanceTimersByTime(HOLD_MS - 50);
    expect(onChange).toHaveBeenCalledTimes(1);

    // А теперь прошёл, и секунда свипа даёт заметно больше одного шага
    vi.advanceTimersByTime(HOLD_MS + 1000);
    expect(onChange.mock.calls.length).toBeGreaterThan(5);

    fireEvent.pointerUp(plus());
    const afterRelease = onChange.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(onChange.mock.calls.length, 'после отпускания свип обязан остановиться').toBe(afterRelease);
  });

  it('значения свипа идут подряд, без пропусков и повторов', () => {
    const onChange = vi.fn();
    fake();
    render(<NumberStepper value="0" onChange={onChange} max={999} />);

    fireEvent.pointerDown(plus());
    vi.advanceTimersByTime(HOLD_MS + 600);
    fireEvent.pointerUp(plus());

    const seen = onChange.mock.calls.map(([v]) => Number(v));
    // ⚠️ СНАЧАЛА — ЧТО СВИП ВООБЩЕ БЫЛ. Без этой строки проверка ниже
    // вырождается в истину на отключённом свипе (`seen` длиной 1, и
    // `forEach` по одному элементу проходит) — то есть сторож зеленел бы
    // на сломанном коде. Поймано мутацией, а не вычиткой.
    expect(seen.length).toBeGreaterThan(3);
    expect(seen[0]).toBe(1);
    // Шаги считаются от НАЧАЛА удержания, а не приращениями за кадр:
    // иначе частота кадров меняла бы результат одного и того же движения
    seen.forEach((v, i) => expect(v).toBe(i + 1));
  });

  it('отмена указателя останавливает свип так же, как отпускание', () => {
    const onChange = vi.fn();
    fake();
    render(<NumberStepper value="0" onChange={onChange} max={999} />);

    fireEvent.pointerDown(plus());
    vi.advanceTimersByTime(HOLD_MS + 300);
    fireEvent.pointerCancel(plus());

    const after = onChange.mock.calls.length;
    // Свип обязан был начаться — иначе «остановился» нечем нарушить
    expect(after).toBeGreaterThan(1);
    vi.advanceTimersByTime(1000);
    expect(onChange.mock.calls.length).toBe(after);
  });

  /**
   * ЦИКЛ НЕ ИМЕЕТ ПРАВА ПЕРЕЖИТЬ РАЗМОНТИРОВАНИЕ: палец мог уйти вместе
   * с закрытой шторкой, и `pointerup` до компонента уже не дойдёт.
   */
  it('размонтирование останавливает свип', () => {
    const onChange = vi.fn();
    fake();
    const { unmount } = render(<NumberStepper value="0" onChange={onChange} max={999} />);

    fireEvent.pointerDown(plus());
    vi.advanceTimersByTime(HOLD_MS + 200);
    unmount();

    const after = onChange.mock.calls.length;
    expect(after, 'свип обязан был начаться — иначе проверка вырождается').toBeGreaterThan(1);
    vi.advanceTimersByTime(2000);
    expect(onChange.mock.calls.length).toBe(after);
  });
});

describe('NumberStepper — границы', () => {
  it('свип упирается в max и гасит кадры', () => {
    const onChange = vi.fn();
    fake();
    render(<NumberStepper value="0" onChange={onChange} max={5} />);

    fireEvent.pointerDown(plus());
    vi.advanceTimersByTime(HOLD_MS + 3000);

    const seen = onChange.mock.calls.map(([v]) => Number(v));
    expect(Math.max(...seen)).toBe(5);
    // После границы цикл остановлен: лишних вызовов с тем же значением нет
    expect(seen.filter((v) => v === 5)).toHaveLength(1);
  });

  it('на границе кнопка недоступна', () => {
    render(<NumberStepper value="10" onChange={() => {}} min={0} max={10} />);
    expect(plus()).toBeDisabled();
    expect(minus()).not.toBeDisabled();
  });

  it('disabled гасит обе кнопки и поле', () => {
    render(<NumberStepper value="5" onChange={() => {}} disabled ariaLabel="Принято" />);
    expect(plus()).toBeDisabled();
    expect(minus()).toBeDisabled();
    expect(screen.getByLabelText('Принято')).toBeDisabled();
  });

  it('набранный текст НЕ зажимается границами', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="" onChange={onChange} min={5} ariaLabel="Сколько" />);
    // При min=5 зажатие на каждом нажатии клавиши превратило бы «1» в «5»,
    // и дописать вторую цифру стало бы невозможно
    fireEvent.change(screen.getByLabelText('Сколько'), { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith('1');
  });
});

describe('NumberStepper — клавиатура', () => {
  it('Enter на кнопке даёт один шаг', () => {
    const onChange = vi.fn();
    render(<NumberStepper value="5" onChange={onChange} />);
    fireEvent.keyDown(plus(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('6');
  });

  it('у обеих кнопок есть доступное имя', () => {
    render(<NumberStepper value="5" onChange={() => {}} />);
    // `aria-label` на элементе БЕЗ РОЛИ не читается вовсе — здесь это
    // настоящие <button>, и имя у них своё, а иконка декоративна
    expect(plus()).toBeInTheDocument();
    expect(minus()).toBeInTheDocument();
  });
});
