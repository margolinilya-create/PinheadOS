import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UpdateBanner from './UpdateBanner';
import { useAppUpdateStore, resetAppUpdateStore, SNOOZE_MS } from '../../store/useAppUpdateStore';

describe('UpdateBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAppUpdateStore();
  });
  afterEach(() => vi.useRealTimers());

  /**
   * Регион существует ДО сообщения — иначе скринридер не объявит его
   * (то же правило, что у `Toast` и `StaleDataBar`). И у него своё имя:
   * `role="status"` на странице не один.
   */
  it('регион смонтирован всегда, пустой — без текста и кнопок', () => {
    render(<UpdateBanner />);
    const region = screen.getByRole('status', { name: 'Обновление приложения' });
    expect(region).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('при обновлении показывает текст и перезагружает только по кнопке', () => {
    const onReload = vi.fn();
    render(<UpdateBanner onReload={onReload} />);
    act(() => useAppUpdateStore.getState().markAvailable());
    expect(screen.getByRole('status', { name: 'Обновление приложения' }))
      .toHaveTextContent('Вышло обновление приложения');
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('«Позже» прячет плашку, и через полчаса она возвращается', () => {
    render(<UpdateBanner />);
    act(() => useAppUpdateStore.getState().markAvailable());
    fireEvent.click(screen.getByRole('button', { name: 'Позже' }));
    expect(screen.queryByRole('button')).toBeNull();

    act(() => { vi.advanceTimersByTime(SNOOZE_MS); });
    expect(screen.getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  });
});
