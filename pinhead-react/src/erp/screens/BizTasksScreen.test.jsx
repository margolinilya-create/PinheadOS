import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import BizTasksScreen from './BizTasksScreen';
import { useErpStore } from '../store/useErpStore';
import { useAuthStore } from '../../store/useAuthStore';

/**
 * ОБЩИЙ РАЗДЕЛ «БИЗНЕС-ЗАДАЧИ» (правки 19.10, п. 7, «Список задач»).
 *
 * По умолчанию — активные задачи, где текущий пользователь ответственный;
 * рядом вкладки «Поставленные мной» и «Наблюдаю». Поиск по названию и номеру
 * заказа, фильтры — в адресе: возврат из карточки «назад» их сохраняет.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../../store/useToastStore', () => ({ toast }));

const FUTURE = '2099-01-01T10:00:00.000Z';

const TASK = (id, over = {}) => ({
  id, order_id: 'o1', title: `Задача ${id}`, kind: 'other', description: null,
  assignee_id: 'u-me', creator_id: 'u-boss', due_at: FUTURE, status: 'new',
  review_required: false, pause_reason: null, cancel_reason: null, return_reason: null,
  result_text: null, result_message_id: null, submitted_at: null, reviewed_at: null,
  completed_at: null, cancelled_at: null, client_key: null,
  created_at: '2026-10-19T08:00:00Z', updated_at: '2026-10-19T08:00:00Z',
  watchers: [], order: { id: 'o1', bitrix_id: '4821', title: 'Худи', tz_number: 'PH-1001' },
  ...over,
});

const PEOPLE = [
  { user_id: 'u-me', name: 'Иванова Мария', email: null, role: 'manager', department_id: null },
  { user_id: 'u-boss', name: 'Петров Пётр', email: null, role: 'director', department_id: null },
  { user_id: 'u-other', name: 'Сидоров Семён', email: null, role: 'purchaser', department_id: null },
];

const ALL = [
  TASK('a', { title: 'Заказать молнии', kind: 'purchase' }),
  TASK('b', { title: 'Забрать ткань', kind: 'delivery', status: 'in_progress',
    order: { id: 'o2', bitrix_id: null, title: 'Футболки', tz_number: 'PH-1234' }, order_id: 'o2' }),
  TASK('c', { title: 'Сданная', status: 'done', completed_at: '2026-10-19T09:00:00Z' }),
  TASK('d', { title: 'Отменённая', status: 'cancelled', cancelled_at: '2026-10-19T09:00:00Z' }),
  // Ответственный другой: в «Мне» нет, в «Поставленные мной» — есть
  TASK('e', { title: 'Чужая, поставил я', assignee_id: 'u-other', creator_id: 'u-me' }),
  // Наблюдаю
  TASK('f', { title: 'Наблюдаемая', assignee_id: 'u-other', watchers: ['u-me'] }),
];

let loadBizTasks;

function setup(tasks = ALL, path = '/biz-tasks') {
  useAuthStore.setState({ user: { id: 'u-me', role: 'manager' } });
  loadBizTasks = vi.fn(async () => tasks);
  useErpStore.setState({
    myRole: 'manager',
    orders: [],
    bizTasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    bizTaskUnread: {},
    bizTaskPing: 0,
    chatDirectory: PEOPLE,
    chatDirectoryLoaded: true,
    loadChatDirectory: vi.fn(async () => {}),
    loadBizTasks,
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/biz-tasks" element={<><BizTasksScreen /><Where /></>} />
        <Route path="/biz-tasks/:taskId" element={<CardStub />} />
      </Routes>
    </MemoryRouter>,
  );
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

function CardStub() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Назад к списку</button>;
}

const rows = () => screen.queryAllByRole('link').map((a) => a.textContent);

beforeEach(() => {
  Object.values(toast).forEach((f) => f.mockClear());
});

describe('BizTasksScreen', () => {
  it('по умолчанию — активные, где я ответственный', async () => {
    setup();
    expect(await screen.findByRole('link', { name: /Заказать молнии/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Мне/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('link', { name: /Забрать ткань/ })).toBeInTheDocument();
    // Закрытые и чужие — не здесь
    expect(screen.queryByRole('link', { name: /Сданная/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Отменённая/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Чужая, поставил я/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Наблюдаемая/ })).toBeNull();
    expect(loadBizTasks).toHaveBeenCalledWith({ scope: 'assignee' });

    // Строка общего раздела — с заказом и постановщиком
    const row = screen.getByRole('link', { name: /Забрать ткань/ });
    expect(row).toHaveTextContent('PH-1234');
    expect(row).toHaveTextContent('Петров Пётр');

    fireEvent.click(screen.getByRole('tab', { name: /Поставленные мной/ }));
    expect(await screen.findByRole('link', { name: /Чужая, поставил я/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Заказать молнии/ })).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/biz-tasks?tab=creator');

    fireEvent.click(screen.getByRole('tab', { name: /Наблюдаю/ }));
    expect(await screen.findByRole('link', { name: /Наблюдаемая/ })).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });

  it('пусто во вкладке «Мне» — объяснение, а не «ничего не нашлось»', async () => {
    setup([TASK('e', { assignee_id: 'u-other', creator_id: 'u-me' })]);
    expect(await screen.findByText('Вам ничего не поручено. Задачи, где вы ответственный, появятся здесь.'))
      .toBeInTheDocument();
  });

  it('фильтры в адресе переживают карточку и «назад»', async () => {
    setup();
    await screen.findByRole('link', { name: /Заказать молнии/ });
    fireEvent.change(screen.getByLabelText('Тип'), { target: { value: 'purchase' } });
    expect(screen.getByTestId('where')).toHaveTextContent('/biz-tasks?kind=purchase');
    expect(rows()).toHaveLength(1);

    fireEvent.click(screen.getByRole('link', { name: /Заказать молнии/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Назад к списку' }));

    await screen.findByRole('link', { name: /Заказать молнии/ });
    expect(screen.getByTestId('where')).toHaveTextContent('/biz-tasks?kind=purchase');
    expect(screen.getByLabelText('Тип')).toHaveValue('purchase');
    expect(screen.queryByRole('link', { name: /Забрать ткань/ })).toBeNull();
  });

  it('поиск по PH-1234', async () => {
    setup();
    await screen.findByRole('link', { name: /Заказать молнии/ });
    fireEvent.change(screen.getByRole('searchbox', { name: /Поиск/ }), { target: { value: 'ph-1234' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Забрать ткань/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('q=ph-1234');

    // По названию — тоже
    fireEvent.change(screen.getByRole('searchbox', { name: /Поиск/ }), { target: { value: 'молни' } });
    expect(screen.getByRole('link', { name: /Заказать молнии/ })).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
  });

  it('под фильтры ничего — «Ничего не нашлось» и «Сбросить фильтры»', async () => {
    setup();
    await screen.findByRole('link', { name: /Заказать молнии/ });
    fireEvent.change(screen.getByRole('searchbox', { name: /Поиск/ }), { target: { value: 'кепка' } });
    expect(screen.getByText('Ничего не нашлось')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
    expect(rows()).toHaveLength(2);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/biz-tasks$/);
  });

  it('статус «Все» и «есть непрочитанные»', async () => {
    setup();
    useErpStore.setState({ bizTaskUnread: { b: 3 } });
    await screen.findByRole('link', { name: /Заказать молнии/ });
    fireEvent.change(screen.getByLabelText('Статус'), { target: { value: 'all' } });
    expect(screen.getByRole('link', { name: /Сданная/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Отменённая/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Есть непрочитанные/ }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole('link', { name: /Забрать ткань/ })).toBeInTheDocument();
  });

  it('ответственный — фильтром во вкладке «Поставленные мной»', async () => {
    setup([...ALL, TASK('g', { title: 'Себе', creator_id: 'u-me' })], '/biz-tasks?tab=creator&status=all');
    await screen.findByRole('link', { name: /Чужая, поставил я/ });
    expect(rows()).toHaveLength(2);
    const who = screen.getByLabelText('Ответственный');
    // Варианты — только ответственные этой вкладки
    expect(within(who).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Любой', 'Иванова Мария', 'Сидоров Семён']);
    fireEvent.change(who, { target: { value: 'u-other' } });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Чужая, поставил я/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('who=u-other');
  });
});
