import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';
import { useErpStore } from '../../store/useErpStore';

/**
 * ОКНО ЧАТА (правка 14.09, п. 5) — клиентская половина трёх требований
 * документа, каждое из которых ломается молча:
 *
 *   · «просмотр переписки отдельной задачи не отмечает прочитанными
 *     сообщения других задач» — гасится ТОТ счётчик, который человек закрыл;
 *   · «новые сообщения появляются без перезагрузки» — звонок realtime
 *     дочитывает ленту, а не дописывает строку из события;
 *   · переключатель «эта задача / вся сделка» — это ВИД, и смена вида
 *     обязана перечитать ленту с новым контекстом, а не отфильтровать
 *     загруженное (сервер отбирает сам).
 */

vi.mock('../../../store/useToastStore', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const MSG = {
  id: 'm1',
  thread_id: 't1',
  author_id: 'u2',
  body: 'Ткань приехала',
  item_id: null,
  stage_id: 's1',
  experimental_id: null,
  reply_to: null,
  created_at: '2026-09-14T10:00:00Z',
  mentions: [],
  attachments: [],
  reply: null,
};

function setup(over = {}) {
  const actions = {
    openChat: vi.fn(async () => {}),
    loadMoreChat: vi.fn(async () => {}),
    refreshChat: vi.fn(async () => {}),
    sendChatMessage: vi.fn(async () => ({ message_id: 'm2', mentioned: [] })),
    loadChatDirectory: vi.fn(async () => {}),
    markChatRead: vi.fn(async () => {}),
    closeChat: vi.fn(),
  };
  useErpStore.setState({
    chatMessages: [MSG],
    chatHasMore: false,
    chatLoading: false,
    chatError: null,
    chatDirectory: [{ user_id: 'u2', name: 'Мария', email: null, role: null, department_id: null }],
    chatUnread: { o1: { total: 3, byStage: { s1: 1 } } },
    chatPing: 0,
    ...actions,
    ...over,
  });
  return actions;
}

beforeEach(() => {
  useErpStore.setState({ chatMessages: [], chatUnread: {}, chatPing: 0 });
});

describe('окно чата: контекст и прочтение', () => {
  it('в контексте задачи отмечает прочитанной ИМЕННО задачу', async () => {
    const a = setup();
    render(<ChatPanel orderId="o1" context={{ stageId: 's1' }} contextLabel="Закрой" />);
    await waitFor(() => expect(a.markChatRead).toHaveBeenCalled());
    // Второй аргумент — этап: `null` погасил бы счётчик ВСЕЙ сделки,
    // чего документ прямо запрещает
    expect(a.markChatRead).toHaveBeenCalledWith('o1', 's1');
  });

  it('в ленте всей сделки гасит общий счётчик', async () => {
    const a = setup();
    render(<ChatPanel orderId="o1" />);
    await waitFor(() => expect(a.markChatRead).toHaveBeenCalledWith('o1', null));
  });

  it('пустая лента ничего не отмечает прочитанным', async () => {
    // Иначе «прочитано» ставилось бы по факту ОТКРЫТИЯ, а не показа
    const a = setup({ chatMessages: [] });
    render(<ChatPanel orderId="o1" />);
    await waitFor(() => expect(a.openChat).toHaveBeenCalled());
    expect(a.markChatRead).not.toHaveBeenCalled();
  });

  it('переключение на «всю сделку» перечитывает ленту с пустым контекстом', async () => {
    const a = setup();
    render(<ChatPanel orderId="o1" context={{ stageId: 's1' }} contextLabel="Закрой" />);
    await waitFor(() => expect(a.openChat).toHaveBeenCalledWith('o1', { stageId: 's1' }));

    fireEvent.click(screen.getByRole('button', { name: /Вся сделка/ }));
    await waitFor(() => expect(a.openChat).toHaveBeenLastCalledWith('o1', {}));
  });

  it('переключателя нет там, где контекста нет', () => {
    setup();
    render(<ChatPanel orderId="o1" />);
    expect(screen.queryByRole('group', { name: 'Что показывать' })).toBeNull();
  });
});

describe('окно чата: звонок realtime', () => {
  it('новое событие дочитывает ленту, а не дописывает строку', async () => {
    const a = setup();
    render(<ChatPanel orderId="o1" />);
    await waitFor(() => expect(a.openChat).toHaveBeenCalled());
    expect(a.refreshChat).not.toHaveBeenCalled();

    useErpStore.setState({ chatPing: 1 });
    await waitFor(() => expect(a.refreshChat).toHaveBeenCalledTimes(1));
  });
});

describe('окно чата: лента', () => {
  it('автор называется по справочнику, а не по полю сообщения', () => {
    setup();
    render(<ChatPanel orderId="o1" />);
    expect(screen.getByText('Мария')).toBeInTheDocument();
    expect(screen.getByText('Ткань приехала')).toBeInTheDocument();
  });

  it('автор вне справочника не оставляет строку безымянной', () => {
    setup({ chatDirectory: [] });
    render(<ChatPanel orderId="o1" />);
    expect(screen.getByText('Сотрудник')).toBeInTheDocument();
  });
});
