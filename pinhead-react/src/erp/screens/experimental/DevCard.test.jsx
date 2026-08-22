import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DevCard } from './DevCard';
import { useErpStore } from '../../store/useErpStore';
import { attachDomainSlices } from '../../store/domainSlices';

attachDomainSlices();

/**
 * Карточка разработки после правок 22.08.
 *
 * ЗДЕСЬ СТОРОЖИТСЯ ДВА ТРЕБОВАНИЯ, КОТОРЫЕ ЛЕГКО ПОТЕРЯТЬ:
 *
 * 1. П. 4.13 — «Построение лекал» нельзя закрыть без технического названия
 *    лекал. Проверка живёт в карточке, а не в списке задач: название
 *    принадлежит разработке, а `DevTasksSection` о ней не знает.
 * 2. П. 4.14 — введённое название попадает в финальный технический пакет
 *    само. Отдельного «переноса» не существует по построению: поле одно,
 *    `erp_experimental.pattern_tech_name`, и его же читает пакет. Тест
 *    проверяет именно это — что запись идёт в РАЗРАБОТКУ, а не в задачу.
 */

const confirmWithInput = vi.fn();
vi.mock('../../../store/useConfirmStore', () => ({
  confirm: vi.fn(async () => true),
  confirmWithInput: (...args) => confirmWithInput(...args),
}));

const DEPTS = [
  { id: 'd1', code: 'sewing', name: 'Швейный', active: true, is_production: true },
];

const task = (over = {}) => ({
  id: 't1', experimental_id: 'e1', task_type: 'patterns', title: null,
  responsible: null, due_date: null, status: 'in_progress', blocked_reason: null,
  depends_on: [], cycle: 0, sort_order: 10, qty: null, comment: null, result: null,
  department_id: null, stage_id: null, done_on: null,
  created_at: '', updated_at: '', ...over,
});

const DEV = {
  id: 'e1', order_id: 'o1', item_id: 'i1', tech_name: 'Худи Free Fit',
  technologist: 'Иванова', pattern_tech_name: null, outcome: null,
  tasks: [task()], attachments: [],
  order: { title: 'Худи', bitrix_id: '4821' },
};

const ORDER = { id: 'o1', bitrix_id: '4821', title: 'Худи', materials: [], items: [] };

function setup(devPatch = {}) {
  const onUpdate = vi.fn(async () => true);
  const onUpdateTask = vi.fn(async () => true);
  const onAddTasks = vi.fn(async () => [{ id: 'new' }]);
  useErpStore.setState({ departments: DEPTS, dictionaries: [] });
  render(
    <MemoryRouter>
      <DevCard
        dev={{ ...DEV, ...devPatch }}
        order={ORDER}
        departments={DEPTS}
        canManage
        onUpdate={onUpdate}
        onAddTasks={onAddTasks}
        onUpdateTask={onUpdateTask}
        onSendTask={vi.fn()}
        onClose={vi.fn()}
        onApproveSample={vi.fn()}
        onUploadFile={vi.fn()}
        onRemoveFile={vi.fn()}
      />
    </MemoryRouter>,
  );
  return { onUpdate, onUpdateTask, onAddTasks };
}

/** Кнопка «Готово» у задачи в работе — в таблице задач этапов */
const doneButton = () => screen.getAllByRole('button', { name: 'Готово' })[0];

beforeEach(() => {
  confirmWithInput.mockReset();
});

describe('построение лекал требует результата', () => {
  it('без названия лекал задача не закрывается', async () => {
    confirmWithInput.mockResolvedValue({ ok: false, value: '' });
    const { onUpdate, onUpdateTask } = setup();

    fireEvent.click(doneButton());

    await waitFor(() => expect(confirmWithInput).toHaveBeenCalled());
    expect(onUpdate).not.toHaveBeenCalled();
    // Отказались вводить — задача осталась открытой
    expect(onUpdateTask).not.toHaveBeenCalled();
  });

  it('введённое название уходит В РАЗРАБОТКУ — это и есть перенос в пакет', async () => {
    confirmWithInput.mockResolvedValue({ ok: true, value: 'PNHD-T04-FreeFit-v1' });
    const { onUpdate, onUpdateTask } = setup();

    fireEvent.click(doneButton());

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith('e1', { pattern_tech_name: 'PNHD-T04-FreeFit-v1' });
    expect(onUpdateTask).toHaveBeenCalledWith('t1', { status: 'done' });
    // Порядок: название сохраняется ДО закрытия задачи, иначе результат
    // потеряется молча при отказе записи
    expect(onUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(onUpdateTask.mock.invocationCallOrder[0]);
  });

  it('название уже есть — второй раз не спрашиваем', async () => {
    const { onUpdateTask } = setup({ pattern_tech_name: 'PNHD-T04-v1' });

    fireEvent.click(doneButton());

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalled());
    expect(confirmWithInput).not.toHaveBeenCalled();
  });

  /** У задач других типов проверки нет: название описывает лекала */
  it('другую задачу закрывает без вопросов', async () => {
    const { onUpdateTask } = setup({ tasks: [task({ id: 't2', task_type: 'sewing_sample' })] });

    fireEvent.click(doneButton());

    await waitFor(() => expect(onUpdateTask).toHaveBeenCalledWith('t2', { status: 'done' }));
    expect(confirmWithInput).not.toHaveBeenCalled();
  });
});

/**
 * П. 4.16: «не нужно заставлять пользователя повторно выбирать одного и того же
 * технолога в каждой микро-задаче». Основной ответственный задан на уровне
 * разработки, у задачи он остаётся переопределяемым.
 */
describe('ответственный по умолчанию', () => {
  it('новая задача получает проработчика разработки', async () => {
    const { onAddTasks } = setup();

    fireEvent.change(screen.getByLabelText('Тип задачи'), { target: { value: 'Примерка' } });
    fireEvent.click(screen.getByRole('button', { name: /Добавить задачу/ }));

    await waitFor(() => expect(onAddTasks).toHaveBeenCalled());
    expect(onAddTasks.mock.calls[0][0][0]).toMatchObject({ responsible: 'Иванова' });
  });
});
