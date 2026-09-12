import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';
import { COMMIT_AT } from './SlideConfirm';

/**
 * Сторож подтверждений: кнопка на мыши, протяжка под пальцем.
 *
 * ⚠️ `matchMedia` В JSDOM НЕТ ВОВСЕ, и `useMediaQuery` в этом случае отдаёт
 * false. То есть по умолчанию здесь «мышь», и ветку протяжки нечем было бы
 * проверить: сторож остался бы зелёным на любом гейте, включая снятый.
 * Поэтому ввод подменяется явно.
 */
function setInput(kind) {
  if (kind === 'none') { delete window.matchMedia; return; }
  window.matchMedia = vi.fn((q) => ({
    matches: kind === 'touch' && q === '(pointer: coarse)',
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/**
 * Геометрия в jsdom нулевая (раскладки нет), а протяжка считает долю пути
 * от ширины трека. Без подмены `fractionAt` всегда вернула бы 0, и «дотянул
 * до порога» стало бы недостижимым — проверка подтверждения была бы зелена
 * и на сломанном пороге.
 */
const TRACK_LEFT = 100;
const TRACK_WIDTH = 300;
function stubTrackGeometry(el) {
  el.getBoundingClientRect = () => ({
    left: TRACK_LEFT, width: TRACK_WIDTH, right: TRACK_LEFT + TRACK_WIDTH,
    top: 0, bottom: 48, height: 48, x: TRACK_LEFT, y: 0, toJSON: () => {},
  });
}
/** clientX, соответствующий доле пути f */
const xAt = (f) => TRACK_LEFT + TRACK_WIDTH * f;

const base = {
  open: true,
  title: 'Завершить этап не полностью?',
  message: 'Оставшиеся 60 шт будут записаны как выполненные.',
  confirmLabel: 'Завершить',
  onCancel: () => {},
};

afterEach(() => {
  cleanup();
  delete window.matchMedia;
});

describe('ConfirmDialog — чем подтверждают', () => {
  it('на мыши опасное действие подтверждает КНОПКА, а не протяжка', () => {
    setInput('mouse');
    render(<ConfirmDialog {...base} variant="danger" onConfirm={() => {}} />);

    // Тянуть мышью неудобно; защита от случайного тапа пальцем здесь не нужна
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
    expect(screen.queryByText(/Проведите до конца/)).not.toBeInTheDocument();
  });

  it('обычное подтверждение под пальцем остаётся кнопкой', () => {
    setInput('touch');
    render(<ConfirmDialog {...base} onConfirm={() => {}} />);

    // Лишний жест на каждом «да/нет» научил бы проводить не глядя
    expect(screen.queryByText(/Проведите до конца/)).not.toBeInTheDocument();
  });

  it('опасное действие под пальцем подтверждают протяжкой', () => {
    setInput('touch');
    render(<ConfirmDialog {...base} variant="danger" onConfirm={() => {}} />);

    expect(screen.getByText(/Проведите до конца/)).toBeInTheDocument();
  });

  it('текст последствий остаётся на месте у обоих вариантов', () => {
    setInput('touch');
    render(<ConfirmDialog {...base} variant="danger" onConfirm={() => {}} />);
    // Протяжка заменяет КНОПКУ, а не объяснение
    expect(screen.getByText(/Оставшиеся 60 шт/)).toBeInTheDocument();
  });
});

describe('SlideConfirm — механика', () => {
  const renderSlide = (props = {}) => {
    setInput('touch');
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} variant="danger" onConfirm={onConfirm} {...props} />);
    const track = screen.getByRole('button', { name: 'Завершить' });
    stubTrackGeometry(track);
    return { track, onConfirm };
  };

  it('протяжка ниже порога НЕ подтверждает', () => {
    const { track, onConfirm } = renderSlide();

    fireEvent.pointerDown(track, { clientX: xAt(0) });
    fireEvent.pointerMove(track, { clientX: xAt(COMMIT_AT - 0.1) });
    fireEvent.pointerUp(track, { clientX: xAt(COMMIT_AT - 0.1) });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * КОММИТ НА ПОРОГЕ, А НЕ НА ОТПУСКАНИИ. Ручка, которую надо довести И
   * отпустить, даёт два способа не сработать — приём взят у bencho именно
   * поэтому.
   */
  it('подтверждает на пороге, ещё до отпускания', () => {
    const { track, onConfirm } = renderSlide();

    fireEvent.pointerDown(track, { clientX: xAt(0) });
    fireEvent.pointerMove(track, { clientX: xAt(COMMIT_AT) });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('подтверждает РОВНО ОДИН раз, сколько бы событий порог ни проехало', () => {
    const { track, onConfirm } = renderSlide();

    fireEvent.pointerDown(track, { clientX: xAt(0) });
    fireEvent.pointerMove(track, { clientX: xAt(COMMIT_AT) });
    fireEvent.pointerMove(track, { clientX: xAt(1) });
    fireEvent.pointerUp(track, { clientX: xAt(1) });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('движение без нажатия не двигает ручку вовсе', () => {
    const { track, onConfirm } = renderSlide();
    // Палец просто проехал над треком — это не протяжка
    fireEvent.pointerMove(track, { clientX: xAt(1) });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * КЛАВИАТУРА — ТОТ ЖЕ ЭЛЕМЕНТ. Правило проекта требует клавиатурной
   * альтернативы у любого перетаскивания (WCAG 2.1.1), и вторая кнопка
   * рядом породила бы вопрос, какая из них правильная.
   */
  it('Enter на треке подтверждает', () => {
    const { track, onConfirm } = renderSlide();
    fireEvent.keyDown(track, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Space на треке подтверждает', () => {
    const { track, onConfirm } = renderSlide();
    fireEvent.keyDown(track, { key: ' ' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('доступное имя трека — это ДЕЙСТВИЕ, а не инструкция по жесту', () => {
    renderSlide();
    // «Проведите вправо» сбивало бы с толку ровно тех, кто проводить не может
    expect(screen.getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
  });

  /**
   * ОБЯЗАТЕЛЬНАЯ ПРИЧИНА ДЕРЖИТ И ПРОТЯЖКУ. Иначе гейт, закрывающий кнопку,
   * обходится жестом — то есть перестаёт существовать под пальцем.
   */
  it('пустая обязательная причина не даёт подтвердить протяжкой', () => {
    const { track, onConfirm } = renderSlide({
      prompt: { label: 'Причина', required: true },
    });

    fireEvent.pointerDown(track, { clientX: xAt(0) });
    fireEvent.pointerMove(track, { clientX: xAt(1) });
    fireEvent.keyDown(track, { key: 'Enter' });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('заполненная причина уезжает вместе с подтверждением', () => {
    const { track, onConfirm } = renderSlide({
      prompt: { label: 'Причина', required: true },
    });

    fireEvent.change(screen.getByLabelText('Причина'), { target: { value: '  сломался нож  ' } });
    fireEvent.keyDown(track, { key: 'Enter' });

    expect(onConfirm).toHaveBeenCalledWith('сломался нож');
  });
});
