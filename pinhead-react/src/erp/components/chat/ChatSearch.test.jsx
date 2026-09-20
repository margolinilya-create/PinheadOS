import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatSearch } from './ChatSearch';
import { useErpStore } from '../../store/useErpStore';

/**
 * ПОИСК ПО ПЕРЕПИСКЕ (вторая очередь чата, документ 20.09, п. 4) — панель.
 *
 * Главное правило тихое: поиск СПРАШИВАЕТ СЕРВЕР, а не фильтрует ленту.
 * Локальный фильтр выглядит работающим ровно до первого «ищу то, что было
 * на прошлой неделе»: лента держит последнюю страницу, и он ответил бы
 * «ничего не найдено» там, где сообщение просто не доехало.
 */

const HIT = {
  id: 'm7',
  author_id: 'u2',
  body: 'Ткань ромашка приехала, 47 кг',
  created_at: '2026-09-18T08:30:00Z',
  item_id: null,
  stage_id: 's1',
  experimental_id: null,
};

beforeEach(() => {
  useErpStore.setState({
    searchChat: vi.fn(async () => [HIT]),
    chatDirectory: [
      { user_id: 'u2', name: 'Мария', email: null, role: null, department_id: null },
    ],
  });
});

const open = (onOpenMessage = vi.fn()) => {
  const r = render(<ChatSearch orderId="o1" onOpenMessage={onOpenMessage} />);
  fireEvent.click(screen.getByLabelText('Поиск по переписке'));
  return { ...r, onOpenMessage };
};

describe('поиск по переписке', () => {
  it('свёрнут до нажатия — в шапке окна одна кнопка', () => {
    render(<ChatSearch orderId="o1" onOpenMessage={() => {}} />);
    expect(screen.getByLabelText('Поиск по переписке')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Найти в переписке')).not.toBeInTheDocument();
  });

  /** Один символ «находит» всю переписку — это не ответ на вопрос */
  it('кнопка «Найти» недоступна, пока меньше двух символов', () => {
    open();
    const find = screen.getByText('Найти');
    expect(find).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Найти в переписке'), { target: { value: 'р' } });
    expect(find).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Найти в переписке'), { target: { value: 'ро' } });
    expect(find).not.toBeDisabled();
  });

  it('ищет на СЕРВЕРЕ и показывает находку с автором', async () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('Найти в переписке'), {
      target: { value: 'ромашка' },
    });
    fireEvent.click(screen.getByText('Найти'));

    await waitFor(() => expect(useErpStore.getState().searchChat)
      .toHaveBeenCalledWith('o1', 'ромашка'));
    expect(await screen.findByText(/Ткань ромашка приехала/)).toBeInTheDocument();
    expect(screen.getByText('Мария')).toBeInTheDocument();
  });

  it('находка ведёт к сообщению и закрывает панель', async () => {
    const onOpenMessage = vi.fn();
    open(onOpenMessage);
    fireEvent.change(screen.getByPlaceholderText('Найти в переписке'), {
      target: { value: 'ромашка' },
    });
    fireEvent.click(screen.getByText('Найти'));

    const hit = await screen.findByText(/Ткань ромашка приехала/);
    fireEvent.click(hit);
    expect(onOpenMessage).toHaveBeenCalledWith(HIT);
    expect(screen.queryByPlaceholderText('Найти в переписке')).not.toBeInTheDocument();
  });

  it('пустой результат говорит об этом, а не показывает пустоту', async () => {
    useErpStore.setState({ searchChat: vi.fn(async () => []) });
    open();
    fireEvent.change(screen.getByPlaceholderText('Найти в переписке'), {
      target: { value: 'чего-то нет' },
    });
    fireEvent.click(screen.getByText('Найти'));
    expect(await screen.findByText('Ничего не нашлось')).toBeInTheDocument();
  });

  it('до поиска списка нет вовсе — ни находок, ни «ничего не нашлось»', () => {
    open();
    expect(screen.queryByText('Ничего не нашлось')).not.toBeInTheDocument();
  });
});
