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
  it('пока канал лежит, лента дочитывается опросом', async () => {
    /**
     * Документ обещает новые сообщения «не позднее чем через 10 секунд»,
     * а подписка умеет падать на минуту переподключения — ровно тогда,
     * когда обещание и нужно.
     */
    vi.useFakeTimers();
    try {
      const a = setup({ realtimeLive: false });
      render(<ChatPanel orderId="o1" />);
      expect(a.refreshChat).not.toHaveBeenCalled();
      vi.advanceTimersByTime(8000);
      expect(a.refreshChat).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('при живом канале опроса нет — это был бы второй источник тех же данных', () => {
    vi.useFakeTimers();
    try {
      const a = setup({ realtimeLive: true });
      render(<ChatPanel orderId="o1" />);
      vi.advanceTimersByTime(30000);
      expect(a.refreshChat).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('новое событие дочитывает ленту, а не дописывает строку', async () => {
    const a = setup();
    render(<ChatPanel orderId="o1" />);
    await waitFor(() => expect(a.openChat).toHaveBeenCalled());
    expect(a.refreshChat).not.toHaveBeenCalled();

    useErpStore.setState({ chatPing: 1 });
    await waitFor(() => expect(a.refreshChat).toHaveBeenCalledTimes(1));
  });
});

describe('окно чата: упоминания', () => {
  it('позвать можно только выбранного из списка', async () => {
    const a = setup({
      chatDirectory: [
        { user_id: 'u2', name: 'Мария', email: 'tehnolog@pnhd.ru', role: null, department_id: null },
      ],
    });
    render(<ChatPanel orderId="o1" />);
    const input = screen.getByLabelText('Новое сообщение');

    fireEvent.change(input, { target: { value: '@Мар', selectionStart: 4 } });
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Мария/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(a.sendChatMessage).toHaveBeenCalled());
    expect(a.sendChatMessage.mock.calls[0][0].mentions).toEqual(['u2']);
  });

  it('набранный руками «@Имя» упоминанием НЕ считается', async () => {
    // Прямое требование документа: иначе уведомление получил бы тёзка
    // или тот, кого автор не звал вовсе
    const a = setup({
      chatDirectory: [
        { user_id: 'u2', name: 'Мария', email: null, role: null, department_id: null },
      ],
    });
    render(<ChatPanel orderId="o1" />);
    const input = screen.getByLabelText('Новое сообщение');

    // Текст вставлен целиком, список не открывался: подсказки после
    // не-пробела нет по построению
    fireEvent.change(input, { target: { value: 'скажи @Мария сама', selectionStart: 17 } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(a.sendChatMessage).toHaveBeenCalled());
    expect(a.sendChatMessage.mock.calls[0][0].mentions).toEqual([]);
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

/**
 * ЛЕНТА: ДНИ, ГРУППЫ И ГРАНИЦА НЕПРОЧИТАННОГО (правка 20.09, п. 4).
 *
 * «Добавить разделители „Сегодня", „Вчера"… При открытии переходить
 * к первому непрочитанному с разделителем „Непрочитанные сообщения"…
 * Последовательные сообщения одного автора в пределах пяти минут объединять
 * визуально».
 */
describe('разделители ленты', () => {
  const at = (iso, over = {}) => ({ ...MSG, created_at: iso, ...over });

  it('день показан разделителем, а не датой у каждого сообщения', () => {
    setup({
      chatMessages: [
        at('2026-09-19T10:00:00+03:00', { id: 'a' }),
        at('2026-09-20T10:00:00+03:00', { id: 'b' }),
      ],
    });
    render(<ChatPanel orderId="o1" />);

    // Две реплики, но подписей дня ровно две — по числу дней
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('граница непрочитанного стоит перед первым непрочитанным', () => {
    setup({
      chatMessages: [
        at('2026-09-20T10:00:00+03:00', { id: 'a' }),
        at('2026-09-20T10:10:00+03:00', { id: 'b' }),
      ],
      // Якорь ставит стор при открытии — панель его только читает
      chatUnreadAnchor: 'b',
    });
    render(<ChatPanel orderId="o1" />);

    expect(screen.getByText('Непрочитанные сообщения')).toBeInTheDocument();
  });

  /**
   * Граница НЕ ВЫЧИСЛЯЕТСЯ из счётчика на каждом кадре: показ ленты тут же
   * гасит счётчик, и черта исчезала бы ровно тогда, когда по ней
   * ориентируются. Здесь счётчик уже нулевой, а якорь стоит — черта обязана
   * остаться.
   */
  it('черта остаётся, даже когда счётчик уже обнулён', () => {
    setup({
      chatMessages: [at('2026-09-20T10:00:00+03:00', { id: 'a' })],
      chatUnread: { o1: { total: 0, byStage: {} } },
      chatUnreadAnchor: 'a',
    });
    render(<ChatPanel orderId="o1" />);
    expect(screen.getByText('Непрочитанные сообщения')).toBeInTheDocument();
  });

  it('имя автора — один раз на группу, а не у каждой реплики', () => {
    setup({
      chatMessages: [
        at('2026-09-20T10:00:00+03:00', { id: 'a' }),
        at('2026-09-20T10:02:00+03:00', { id: 'b' }),
      ],
    });
    render(<ChatPanel orderId="o1" />);
    expect(screen.getAllByText('Мария')).toHaveLength(1);
  });

  it('разрыв больше пяти минут — имя показывается снова', () => {
    setup({
      chatMessages: [
        at('2026-09-20T10:00:00+03:00', { id: 'a' }),
        at('2026-09-20T10:30:00+03:00', { id: 'b' }),
      ],
    });
    render(<ChatPanel orderId="o1" />);
    expect(screen.getAllByText('Мария')).toHaveLength(2);
  });
});

/**
 * «НОВЫЕ СООБЩЕНИЯ, N» (правка 20.09, п. 4): «если человек читает историю
 * выше, показывать индикатор новых сообщений с переходом вниз».
 *
 * Сторож проверяет ИМЕННО РАЗВИЛКУ: у низа ленты индикатора быть не должно
 * (там всё и так видно), выше — должен, и с числом пришедшего после ухода
 * от низа. Счётчик вкладки для этого не годится: `markChatRead` гасит его
 * по показу ленты, а человек стоит выше и пришедшего внизу не видел.
 */
describe('индикатор новых сообщений ниже', () => {
  const at = (iso, over = {}) => ({ ...MSG, created_at: iso, ...over });

  const scrollTo = (feed, { scrollTop, scrollHeight, clientHeight }) => {
    Object.defineProperty(feed, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(feed, 'clientHeight', { value: clientHeight, configurable: true });
    feed.scrollTop = scrollTop;
    fireEvent.scroll(feed);
  };

  const feedOf = () => screen.getByLabelText('Обсуждение сделки')
    .querySelector('[class*="chatFeed"]');

  it('у низа ленты индикатора нет', () => {
    setup({ chatMessages: [at('2026-09-20T10:00:00+03:00', { id: 'a' })] });
    render(<ChatPanel orderId="o1" />);
    scrollTo(feedOf(), { scrollTop: 500, scrollHeight: 600, clientHeight: 100 });
    expect(screen.queryByText(/Новые сообщения/)).not.toBeInTheDocument();
  });

  it('человек ушёл вверх — пришедшее после считается и показывается', () => {
    setup({ chatMessages: [at('2026-09-20T10:00:00+03:00', { id: 'a' })] });
    const { rerender } = render(<ChatPanel orderId="o1" />);
    // Ушёл читать историю
    scrollTo(feedOf(), { scrollTop: 0, scrollHeight: 600, clientHeight: 100 });
    expect(screen.queryByText(/Новые сообщения/)).not.toBeInTheDocument();

    // Пока он наверху, пришли две реплики
    useErpStore.setState({
      chatMessages: [
        at('2026-09-20T10:00:00+03:00', { id: 'a' }),
        at('2026-09-20T10:40:00+03:00', { id: 'b' }),
        at('2026-09-20T10:41:00+03:00', { id: 'c' }),
      ],
    });
    rerender(<ChatPanel orderId="o1" />);
    expect(screen.getByText(/Новые сообщения, 2/)).toBeInTheDocument();
  });

  it('переход вниз гасит индикатор', () => {
    setup({ chatMessages: [at('2026-09-20T10:00:00+03:00', { id: 'a' })] });
    const { rerender } = render(<ChatPanel orderId="o1" />);
    scrollTo(feedOf(), { scrollTop: 0, scrollHeight: 600, clientHeight: 100 });
    useErpStore.setState({
      chatMessages: [
        at('2026-09-20T10:00:00+03:00', { id: 'a' }),
        at('2026-09-20T10:40:00+03:00', { id: 'b' }),
      ],
    });
    rerender(<ChatPanel orderId="o1" />);

    fireEvent.click(screen.getByText(/Новые сообщения/));
    expect(screen.queryByText(/Новые сообщения/)).not.toBeInTheDocument();
  });
});
