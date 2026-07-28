import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StageActionsPanel } from './StageActionsPanel';

/**
 * Действия цеха над заданием — общий компонент строки очереди и страницы
 * производственного задания.
 *
 * Ключевое здесь — контракт payload у onDefect: форма брака переехала из
 * панели в пошаговый DefectWizard, и состав объекта не должен был измениться.
 */

/** Все права выданы: гейты матрицы проверяются отдельно, здесь — поведение формы */
const ALL_PERMS = { any: true, take: true, progress: true, complete: true, block: true, defect: true };

const ORDER = {
  id: 'o1',
  title: 'Худи «Ромашка»',
  bitrix_id: '4821',
  due_date: '2026-08-30',
  packaging: 'none',
  stickers: 'none',
  attachments: [],
  materials: [],
  procurement_tasks: [],
};

const OTHER_STAGE = { id: 's2', department_id: 'd2', status: 'done' };

function makeEntry(group, patch = {}) {
  const stage = {
    id: 's1',
    department_id: 'd1',
    status: group === 'done' ? 'done' : group === 'blocked' ? 'blocked' : group,
    qty_done: 0,
    qty_rework: 0,
    planned_end: null,
    block_reason: group === 'blocked' ? 'Нет ниток' : null,
    overdue_ack_at: null,
    overdue_comment: null,
    ...patch,
  };
  const item = { id: 'i1', product_type: 'Худи', variant: null, qty: 10, stages: [stage, OTHER_STAGE] };
  return { order: ORDER, item, stage, reason: null, group };
}

const DEPT_SHORT = new Map([['d2', 'Закрой']]);

function renderCard(entry, { perms = ALL_PERMS } = {}) {
  const handlers = {
    onStart: vi.fn(), onDone: vi.fn(), onProgress: vi.fn(), onBlock: vi.fn(),
    onUnblock: vi.fn(), onDefect: vi.fn(), onAckOverdue: vi.fn(),
  };
  render(
    <MemoryRouter>
      <StageActionsPanel
        entry={entry}
        perms={perms}
        deptShortById={DEPT_SHORT}
        actions={handlers}
        showTz={false}
      />
    </MemoryRouter>,
  );
  return handlers;
}

describe('StageActionsPanel — действия по группам', () => {
  it('ready: «Взять в работу» и «Проблема»', () => {
    renderCard(makeEntry('ready'));
    expect(screen.getByRole('button', { name: /Взять в работу/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Проблема/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Завершить этап/ })).toBeNull();
  });

  it('in_progress: «Частично», «Готово», «Брак», «Проблема»', () => {
    renderCard(makeEntry('in_progress'));
    for (const name of [/Записать результат/, /Завершить этап/, /Брак/, /Проблема/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('done: только «Брак / переделка»', () => {
    renderCard(makeEntry('done'));
    expect(screen.getByRole('button', { name: /Брак \/ переделка/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Взять в работу/ })).toBeNull();
  });

  it('blocked: «Снять блокировку» вызывает onUnblock', async () => {
    const handlers = renderCard(makeEntry('blocked'));
    fireEvent.click(screen.getByRole('button', { name: 'Снять блокировку' }));
    await waitFor(() => expect(handlers.onUnblock).toHaveBeenCalledTimes(1));
  });

  it('без прав матрицы кнопок нет', () => {
    renderCard(makeEntry('ready'), {
      perms: { any: false, take: false, progress: false, complete: false, block: false, defect: false },
    });
    expect(screen.queryByRole('button', { name: /Взять в работу/ })).toBeNull();
  });

  it('снятое право «Оформлять брак» убирает кнопку, остальные остаются', () => {
    renderCard(makeEntry('in_progress'), { perms: { ...ALL_PERMS, defect: false } });
    expect(screen.queryByRole('button', { name: /^Брак$/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Проблема/ })).toBeInTheDocument();
  });

  it('«Взять в работу» открывает план завершения и передаёт дату', async () => {
    const handlers = renderCard(makeEntry('ready'));
    fireEvent.click(screen.getByRole('button', { name: /Взять в работу/ }));
    const date = screen.getByLabelText('Плановая дата завершения');
    fireEvent.change(date, { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByRole('button', { name: /^В работу$/ }));
    await waitFor(() => expect(handlers.onStart).toHaveBeenCalledWith(expect.objectContaining({ group: 'ready' }), '2026-08-20'));
  });

  it('«Проблема» требует текст и передаёт его в onBlock', async () => {
    const handlers = renderCard(makeEntry('ready'));
    fireEvent.click(screen.getByRole('button', { name: /Проблема/ }));
    const block = screen.getByRole('button', { name: 'Заблокировать' });
    expect(block).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/брак кроя/i), { target: { value: 'Порвался нож' } });
    fireEvent.click(screen.getByRole('button', { name: 'Заблокировать' }));
    await waitFor(() => expect(handlers.onBlock).toHaveBeenCalledWith(expect.anything(), 'Порвался нож', null));
  });
});

describe('StageActionsPanel — мастер брака', () => {
  let handlers;
  beforeEach(() => {
    handlers = renderCard(makeEntry('in_progress'));
    fireEvent.click(screen.getByRole('button', { name: /^Брак$/ }));
  });

  const wizard = () => screen.getByRole('dialog', { name: 'Брак / переделка' });

  it('открывается боковой панелью с первым шагом', () => {
    expect(wizard()).toBeInTheDocument();
    expect(screen.getByLabelText(/Сколько штук в брак/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Причина брака/)).toBeInTheDocument();
  });

  it('«Далее» заблокировано, пока не заполнены количество и причина', () => {
    const next = screen.getByRole('button', { name: 'Далее' });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '3' } });
    expect(next).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    expect(next).toBeEnabled();
  });

  it('количество больше, чем в позиции, показывает ошибку и не пускает дальше', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    expect(screen.getByText('В позиции всего 10 шт')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled();
  });

  it('второй шаг предлагает вернуть на другой этап маршрута', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));

    const select = screen.getByLabelText('Где устранять');
    expect(within(select).getByText('Вернуть: Закрой')).toBeInTheDocument();
    expect(within(select).getByText('На закупку (материал испорчен)')).toBeInTheDocument();
    expect(within(select).getByText('Отправить подрядчику')).toBeInTheDocument();
  });

  it('простой случай: payload сохраняет прежний состав', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Кривая строчка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.click(screen.getByRole('button', { name: 'В переделку' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload, photo] = handlers.onDefect.mock.calls[0];
    expect(payload).toEqual({
      qty: 2,
      reason: 'Кривая строчка',
      target: 'current',
      needsMaterial: false,
      cause: 'other',
      supplier: null,
      plannedDate: null,
      materialName: null,
      subcontractOperation: null,
      contractor: null,
    });
    expect(photo).toBeNull();
  });

  it('возврат подрядчику: операция и контрагент попадают в payload', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Перешить' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 'subcontractor' } });
    fireEvent.change(screen.getByLabelText('Операция подряда'), { target: { value: 'Перешив низа' } });
    fireEvent.change(screen.getByLabelText('Контрагент'), { target: { value: 'ООО Швейка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить подрядчику' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload] = handlers.onDefect.mock.calls[0];
    expect(payload).toMatchObject({
      target: 'subcontractor',
      subcontractOperation: 'Перешив низа',
      contractor: 'ООО Швейка',
    });
  });

  it('на закупку: needsMaterial форсится, материал и срок уходят в payload', async () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Прожгли ткань' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 'procurement' } });
    fireEvent.change(screen.getByLabelText('Материал'), { target: { value: 'Кулирка чёрная' } });
    fireEvent.change(screen.getByLabelText('Плановая дата замены'), { target: { value: '2026-08-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'В переделку + заявка' }));

    await waitFor(() => expect(handlers.onDefect).toHaveBeenCalledTimes(1));
    const [, payload] = handlers.onDefect.mock.calls[0];
    expect(payload).toMatchObject({
      target: 'procurement',
      needsMaterial: true,
      materialName: 'Кулирка чёрная',
      plannedDate: '2026-08-10',
    });
  });

  it('возврат «на закупку» форсит галку «нужен новый материал»', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Прожгли' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));

    const check = screen.getByLabelText(/Нужен новый материал/);
    expect(check).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Где устранять'), { target: { value: 'procurement' } });
    // галка отражает факт: закупка нужна по определению, менять её нельзя
    expect(check).toBeChecked();
    expect(check).toBeDisabled();
  });

  it('«Назад» возвращает на первый шаг, «Отмена» закрывает мастер', () => {
    fireEvent.change(screen.getByLabelText(/Сколько штук в брак/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Причина брака/), { target: { value: 'Пятно' } });
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
    fireEvent.click(screen.getByRole('button', { name: /Назад/ }));
    expect(screen.getByLabelText(/Сколько штук в брак/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Брак / переделка' })).toBeNull();
    expect(handlers.onDefect).not.toHaveBeenCalled();
  });
});
