import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatReactions } from './ChatReactions';
import { REACTION_CHOICES } from '../../utils/chatReactions';
import { useErpStore } from '../../store/useErpStore';

/**
 * РЕАКЦИИ (вторая очередь чата, документ 20.09, п. 4) — клиентская половина.
 *
 * Здесь проверяется ровно то, чего не видит сервер:
 *
 *   · показываются ПОСТАВЛЕННЫЕ, а набор открывается по кнопке — полоска
 *     из шести серых лиц под каждой репликой это шесть предложений нажать
 *     на то, что никому не нужно;
 *   · своя реакция отличима до нажатия (`aria-pressed`), иначе человек
 *     ставит её второй раз, чтобы понять, что она уже стоит;
 *   · у удалённого сообщения набора нет вовсе — реакция на пустое место.
 */

beforeEach(() => {
  useErpStore.setState({
    toggleChatReaction: vi.fn(async () => true),
    loadChatReactionPeople: vi.fn(async () => [
      { emoji: '👍', user_id: 'u2', name: 'Мария' },
    ]),
  });
});

describe('реакции сообщения', () => {
  it('показывают поставленные со счётчиком', () => {
    render(<ChatReactions messageId="m1" reactions={[{ emoji: '👍', count: 2, mine: false }]} />);
    expect(screen.getByLabelText('👍, 2')).toBeInTheDocument();
  });

  it('своя отличима до нажатия', () => {
    render(<ChatReactions messageId="m1" reactions={[{ emoji: '👍', count: 1, mine: true }]} />);
    expect(screen.getByLabelText('👍, 1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('нажатие переключает через сервер', async () => {
    render(<ChatReactions messageId="m1" reactions={[{ emoji: '👍', count: 1, mine: true }]} />);
    fireEvent.click(screen.getByLabelText('👍, 1'));
    await waitFor(() => expect(useErpStore.getState().toggleChatReaction)
      .toHaveBeenCalledWith('m1', '👍'));
  });

  it('набор закрыт, пока его не открыли', () => {
    render(<ChatReactions messageId="m1" reactions={[]} />);
    for (const emoji of REACTION_CHOICES) {
      expect(screen.queryByLabelText(emoji)).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText('Поставить реакцию')).toBeInTheDocument();
  });

  it('из набора ставится выбранное', async () => {
    render(<ChatReactions messageId="m1" reactions={[]} />);
    fireEvent.click(screen.getByLabelText('Поставить реакцию'));
    fireEvent.click(screen.getByLabelText('🔥'));
    await waitFor(() => expect(useErpStore.getState().toggleChatReaction)
      .toHaveBeenCalledWith('m1', '🔥'));
    // и закрывается: набор — разовый выбор, а не панель
    expect(screen.queryByLabelText('😀')).not.toBeInTheDocument();
  });

  /** Имена — по наведению и ОДНИМ вызовом: лента это полсотни сообщений */
  it('кто поставил — подгружается при наведении', async () => {
    render(<ChatReactions messageId="m1" reactions={[{ emoji: '👍', count: 1, mine: false }]} />);
    const pill = screen.getByLabelText('👍, 1');
    expect(pill).toHaveAttribute('title', 'Кто поставил — наведите');

    fireEvent.mouseEnter(pill);
    await waitFor(() => expect(screen.getByLabelText('👍, 1')).toHaveAttribute('title', 'Мария'));
    // Повторное наведение не идёт на сервер второй раз
    fireEvent.mouseEnter(pill);
    expect(useErpStore.getState().loadChatReactionPeople).toHaveBeenCalledTimes(1);
  });

  it('у удалённого сообщения нет ни набора, ни пустой полоски', () => {
    const { container } = render(<ChatReactions messageId="m1" reactions={[]} disabled />);
    expect(container).toBeEmptyDOMElement();
  });

  it('у удалённого с прежними реакциями они видны, но не нажимаются', () => {
    render(
      <ChatReactions messageId="m1" reactions={[{ emoji: '👍', count: 1, mine: true }]} disabled />,
    );
    expect(screen.getByLabelText('👍, 1')).toBeDisabled();
    expect(screen.queryByLabelText('Поставить реакцию')).not.toBeInTheDocument();
  });
});
