import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OrderBizTasksTab from './OrderBizTasksTab';
import { useErpStore } from '../../store/useErpStore';
import { useAuthStore } from '../../../store/useAuthStore';

/**
 * ВКЛАДКА «БИЗНЕС-ЗАДАЧИ» КАРТОЧКИ ЗАКАЗА (правки 19.10, п. 7).
 *
 * Счётчики открытых, просроченных и завершённых; по умолчанию — открытые,
 * завершённые и отменённые доступны фильтром. Пусто — объяснение и «Создать
 * задачу». После создания — toast и фокус на новую строку.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));

const ORDER = { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', status: 'active' };
const PAST = '2001-01-01T10:00:00.000Z';
const FUTURE = '2099-01-01T10:00:00.000Z';

const TASK = (id, over = {}) => ({
  id, order_id: 'o1', title: `Задача ${id}`, kind: 'other', description: null,
  assignee_id: 'u-petrov', creator_id: 'u-me', due_at: FUTURE, status: 'new',
  review_required: false, pause_reason: null, cancel_reason: null, return_reason: null,
  result_text: null, result_message_id: null, submitted_at: null, reviewed_at: null,
  completed_at: null, cancelled_at: null, client_key: null,
  created_at: '2026-10-19T08:00:00Z', updated_at: '2026-10-19T08:00:00Z',
  watchers: [], order: null, ...over,
});

const PEOPLE = [
  { user_id: 'u-petrov', name: 'Петров Пётр', email: null, role: 'purchaser', department_id: null },
];

function setup(tasks, { order = ORDER, myRole = 'manager' } = {}) {
  useAuthStore.setState({ user: { id: 'u-me', role: 'manager' } });
  useErpStore.setState({
    myRole,
    bizTasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    bizTaskUnread: {},
    chatDirectory: PEOPLE,
    chatDirectoryLoaded: true,
    loadChatDirectory: vi.fn(async () => {}),
    createBizTask: vi.fn(async (input) => {
      const row = TASK('t-new', { ...input, title: input.title });
      useErpStore.setState((s) => ({ bizTasks: { ...s.bizTasks, [row.id]: row } }));
      return row;
    }),
    attachBizTaskFiles: vi.fn(),
  });
  return render(
    <MemoryRouter>
      <OrderBizTasksTab order={order} loaded failed={false} onRetry={() => {}} />
    </MemoryRouter>,
  );
}

const ALL = [
  TASK('a', { status: 'new' }),
  TASK('b', { status: 'in_progress', due_at: PAST }),
  TASK('c', { status: 'paused' }),
  TASK('d', { status: 'done', completed_at: '2026-10-19T09:00:00Z' }),
  TASK('e', { status: 'cancelled', cancelled_at: '2026-10-19T09:00:00Z' }),
  // Чужой заказ — не в этой вкладке
  TASK('x', { order_id: 'o2' }),
];

beforeEach(() => {
  Object.values(toast).forEach((f) => f.mockClear());
});

describe('OrderBizTasksTab', () => {
  it('счётчики открытых, просроченных, завершённых; завершённые и отменённые — фильтром', () => {
    setup(ALL);
    const open = screen.getByRole('button', { name: /Открытые/ });
    expect(open).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /Просроченные/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Завершённые/ })).toHaveTextContent('1');

    // По умолчанию — только открытые
    expect(screen.getByRole('link', { name: /Задача a/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Задача b/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Задача d/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Задача e/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Задача x/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Просроченные/ }));
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('Задача b')]);

    fireEvent.click(screen.getByRole('button', { name: /Завершённые/ }));
    expect(screen.getByRole('link', { name: /Задача d/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Задача a/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Отменённые/ }));
    expect(screen.getByRole('link', { name: /Задача e/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Задача d/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Все/ }));
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('пустое состояние', () => {
    setup([]);
    expect(screen.getByText('По заказу нет задач. Поручите доставку, закупку или другое дело.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));
    expect(screen.getByRole('textbox', { name: /Название/ })).toBeInTheDocument();
  });

  it('открытых нет, а задачи есть — не «пусто», а пустой фильтр со сбросом', () => {
    setup([TASK('d', { status: 'done' })]);
    expect(screen.queryByText(/По заказу нет задач/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать все' }));
    expect(screen.getByRole('link', { name: /Задача d/ })).toBeInTheDocument();
  });

  it('после создания — toast «Задача создана» и фокус на новую строку', async () => {
    setup([TASK('d', { status: 'done' })]);
    // Человек смотрел завершённые — новая задача всё равно должна оказаться на экране
    fireEvent.click(screen.getByRole('button', { name: /Завершённые/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Название/ }), { target: { value: 'Забрать ткань' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Доставка' }));
    const who = screen.getByRole('combobox', { name: 'Ответственный' });
    fireEvent.focus(who);
    fireEvent.change(who, { target: { value: 'Пет' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Петров/ }));
    fireEvent.change(screen.getByLabelText(/Срок/), { target: { value: '2099-10-20T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать задачу' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Задача создана'));
    const row = await screen.findByRole('link', { name: /Забрать ткань/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(screen.queryByRole('textbox', { name: /Название/ })).toBeNull();
  });

  it('у закрытого заказа «Создать задачу» объясняет, почему нельзя', () => {
    setup([], { order: { ...ORDER, status: 'done_on_time' } });
    const btn = screen.getByRole('button', { name: 'Создать задачу' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Заказ закрыт — новые задачи к нему не ставятся')).toBeInTheDocument();
  });

  it('не сотрудник ERP задачу не ставит — сервер откажет', () => {
    setup([], { myRole: null });
    expect(screen.getByRole('button', { name: 'Создать задачу' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Задачи ставят сотрудники ERP')).toBeInTheDocument();
  });
});
