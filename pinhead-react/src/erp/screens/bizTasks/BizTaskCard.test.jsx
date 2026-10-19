import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BizTaskCard } from './BizTaskCard';
import { useErpStore } from '../../store/useErpStore';
import { useAuthStore } from '../../../store/useAuthStore';

/**
 * КАРТОЧКА БИЗНЕС-ЗАДАЧИ (правки 19.10, п. 7).
 *
 * Кнопки — по роли и статусу (`bizTaskActions`, зеркало писателей). Открытие
 * отмечает «видел» (`markBizTaskSeen`), статус не меняет. Диалог справа —
 * `ChatPanel` (Task 8), здесь заглушка. На ≤ 760 px — один ряд из четырёх
 * вкладок «Задача · Обсуждение · История · Файлы».
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));

const access = vi.hoisted(() => ({ manage: false }));
vi.mock('../../store/useErpAccess', () => ({
  useErpAccess: () => ({ can: (p) => p === 'biz_task.manage' && access.manage }),
}));

vi.mock('../../components/chat/ChatPanel', () => ({
  ChatPanel: ({ taskId }) => <section aria-label="Обсуждение задачи" data-task={taskId} />,
}));

const FUTURE = '2099-10-20T15:00:00.000Z';

const TASK = (over = {}) => ({
  id: 't1', order_id: 'o1', title: 'Забрать ткань у поставщика', kind: 'delivery',
  description: 'Откуда: склад «Текстиль»', assignee_id: 'u-ivan', creator_id: 'u-olga', due_at: FUTURE,
  status: 'new', review_required: false, pause_reason: null, cancel_reason: null, return_reason: null,
  result_text: null, result_message_id: null, submitted_at: null, reviewed_at: null,
  completed_at: null, cancelled_at: null, client_key: null,
  created_at: '2026-10-19T08:00:00Z', updated_at: '2026-10-19T08:00:00Z',
  watchers: ['u-petr'], order: { id: 'o1', bitrix_id: '4821', title: 'Худи «Ромашка»', tz_number: 'PH-1042' },
  ...over,
});

const DETAIL = (over = {}) => ({ watchers: ['u-petr'], checklist: [], events: [], files: [], ...over });

const PEOPLE = [
  { user_id: 'u-ivan', name: 'Иванов Иван', email: null, role: 'worker', department_id: null },
  { user_id: 'u-olga', name: 'Ольга Смирнова', email: null, role: 'manager', department_id: null },
  { user_id: 'u-petr', name: 'Петров Пётр', email: null, role: 'purchaser', department_id: null },
];

function setup({ me = 'u-ivan', task = TASK(), detail = DETAIL(), manage = false } = {}) {
  access.manage = manage;
  useAuthStore.setState({ user: { id: me, role: 'manager' } });
  const actions = {
    markBizTaskSeen: vi.fn(async () => task),
    bizTaskTransition: vi.fn(async (id, action) => ({ ...task, status: action === 'pause' ? 'paused' : task.status })),
    updateBizTask: vi.fn(async () => task),
    bizTaskChecklistOp: vi.fn(async () => task),
    attachBizTaskFiles: vi.fn(async () => task),
    loadBizTask: vi.fn(async () => detail),
    loadChatDirectory: vi.fn(async () => {}),
  };
  useErpStore.setState({
    myRole: 'worker',
    bizTasks: { [task.id]: task },
    bizTaskDetails: { [task.id]: detail },
    chatDirectory: PEOPLE,
    ...actions,
  });
  render(
    <MemoryRouter initialEntries={[`/biz-tasks/${task.id}`]}>
      <BizTaskCard taskId={task.id} back="/biz-tasks" />
    </MemoryRouter>,
  );
  return actions;
}

function mockWidth(narrow) {
  window.matchMedia = (query) => ({
    matches: narrow && query.includes('760'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

beforeEach(() => {
  Object.values(toast).forEach((f) => f.mockClear());
});
afterEach(() => {
  delete window.matchMedia;
});

describe('BizTaskCard', () => {
  it('ответственный в «Новая» видит «Взять в работу»; открытие зовёт markBizTaskSeen, статус не меняется', async () => {
    const a = setup();
    expect(screen.getByRole('button', { name: 'Взять в работу' })).toBeInTheDocument();
    await waitFor(() => expect(a.markBizTaskSeen).toHaveBeenCalledWith('t1'));
    expect(a.bizTaskTransition).not.toHaveBeenCalled();
    expect(screen.getByText('Новая')).toBeInTheDocument();
    // Диалог задачи — справа, по taskId (ленивым чанком)
    expect(await screen.findByRole('region', { name: 'Обсуждение задачи' })).toHaveAttribute('data-task', 't1');

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }));
    await waitFor(() => expect(a.bizTaskTransition).toHaveBeenCalledWith('t1', 'start', null));
  });

  it('«Приостановить» требует причину', async () => {
    const a = setup({ task: TASK({ status: 'in_progress' }) });
    fireEvent.click(screen.getByRole('button', { name: 'Приостановить' }));
    const dialog = screen.getByRole('dialog', { name: 'Приостановить задачу?' });
    const confirm = within(dialog).getByRole('button', { name: 'Приостановить' });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(confirm);
    expect(a.bizTaskTransition).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Причина/), { target: { value: 'Ждём поставщика' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Приостановить' }));
    await waitFor(() => expect(a.bizTaskTransition).toHaveBeenCalledWith('t1', 'pause', 'Ждём поставщика'));
  });

  it('проверка постановщиком: «Сдать на проверку», у постановщика «Принять»/«Вернуть в работу»', () => {
    setup({ task: TASK({ status: 'in_progress', review_required: true }) });
    expect(screen.getByRole('button', { name: 'Сдать на проверку' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull();
  });

  it('проверка постановщиком: у постановщика в «На проверке» — «Принять» и «Вернуть в работу»', () => {
    setup({
      me: 'u-olga',
      task: TASK({ status: 'review', review_required: true, result_text: 'Ткань на складе', submitted_at: '2026-10-19T10:00:00Z' }),
    });
    expect(screen.getByRole('button', { name: 'Принять' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вернуть в работу' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сдать на проверку' })).toBeNull();
    // Результат — отдельным блоком
    expect(screen.getByRole('heading', { name: 'Результат' })).toBeInTheDocument();
    expect(screen.getAllByText('Ткань на складе').length).toBeGreaterThan(0);
  });

  it('завершение с невыполненными пунктами — предупреждение', () => {
    const checklist = [1, 2, 3, 4, 5].map((n) => ({
      id: `c${n}`, task_id: 't1', text: `Пункт ${n}`, done: n <= 3, sort: n, done_by: null, done_at: null,
    }));
    setup({ task: TASK({ status: 'in_progress' }), detail: DETAIL({ checklist }) });
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));
    const dialog = screen.getByRole('dialog', { name: 'Не выполнено 2 пункта чек-листа из 5. Завершить?' });
    expect(within(dialog).getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуться к чек-листу' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('наблюдатель не видит «Завершить», «Перенести срок», «Сменить ответственного»', () => {
    setup({ me: 'u-petr', task: TASK({ status: 'in_progress' }) });
    expect(screen.queryByRole('button', { name: 'Завершить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перенести срок' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сменить ответственного' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить задачу' })).toBeNull();
    // Чек-лист наблюдатель не отмечает
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('перенос срока — прежний и новый срок с причиной в истории', async () => {
    const events = [{
      id: 2, task_id: 't1', kind: 'due_changed', actor: 'u-olga', due_at: null, at: '2026-10-19T09:00:00Z',
      payload: { from: '2026-10-20T15:00:00+00:00', to: '2026-10-22T15:00:00+00:00', reason: 'Поставщик сдвинул отгрузку' },
    }];
    const a = setup({ me: 'u-olga', detail: DETAIL({ events }) });
    const history = screen.getByRole('region', { name: 'История' });
    expect(within(history).getByText(
      'Срок перенесён: 20.10, 18:00 → 22.10, 18:00 МСК. Причина: Поставщик сдвинул отгрузку',
    )).toBeInTheDocument();
    expect(within(history).getByText('Ольга Смирнова')).toBeInTheDocument();

    // Перенос: новый срок и причина уходят одним вызовом
    fireEvent.click(screen.getByRole('button', { name: 'Перенести срок' }));
    const dialog = screen.getByRole('dialog', { name: 'Перенести срок' });
    fireEvent.change(within(dialog).getByLabelText(/Новый срок/), { target: { value: '2099-10-25T12:00' } });
    const save = within(dialog).getByRole('button', { name: 'Перенести' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(within(dialog).getByLabelText(/Причина переноса/), { target: { value: 'Попросил клиент' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(a.updateBizTask).toHaveBeenCalledWith('t1', {
      due_at: '2099-10-25T09:00:00.000Z', due_reason: 'Попросил клиент',
    }));
  });

  it('ссылка на заказ — /orders/:id?tab=tasks', () => {
    setup();
    expect(screen.getByRole('link', { name: /Заказ PH-1042/ })).toHaveAttribute('href', '/orders/o1?tab=tasks');
  });

  it('375 px — один ряд из четырёх вкладок', async () => {
    mockWidth(true);
    setup();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Задача', 'Обсуждение', 'История', 'Файлы']);
    // По умолчанию — «Задача»; диалога в DOM нет, пока не выбран
    expect(screen.queryByRole('region', { name: 'Обсуждение задачи' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Обсуждение' }));
    expect(await screen.findByRole('region', { name: 'Обсуждение задачи' })).toBeInTheDocument();
  });

  it('на компьютере вкладок нет: история и файлы — под левой колонкой', () => {
    mockWidth(false);
    setup();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('region', { name: 'История' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Файлы' })).toBeInTheDocument();
  });

  it('файлы — автор, время и ссылка на исходное сообщение', () => {
    const files = [
      { id: 'f1', order_id: 'o1', file_path: 'att/o1/biz_task/a.pdf', file_name: 'накладная.pdf', kind: 'biz_task',
        biz_task_id: 't1', message_id: null, uploaded_by: 'u-olga', created_at: '2026-10-19T08:30:00Z' },
      { id: 'f2', order_id: 'o1', file_path: 'att/o1/chat/b.jpg', file_name: 'фото.jpg', kind: 'chat',
        biz_task_id: 't1', message_id: 'm7', uploaded_by: 'u-ivan', created_at: '2026-10-19T09:30:00Z' },
    ];
    setup({ detail: DETAIL({ files }) });
    const region = screen.getByRole('region', { name: 'Файлы' });
    expect(within(region).getByRole('link', { name: 'накладная.pdf' })).toBeInTheDocument();
    expect(within(region).getByText(/Описание · Ольга Смирнова · 19\.10, 11:30/)).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /К сообщению/ })).toHaveAttribute('href', '/biz-tasks/t1?msg=m7&pane=chat');
  });
});
