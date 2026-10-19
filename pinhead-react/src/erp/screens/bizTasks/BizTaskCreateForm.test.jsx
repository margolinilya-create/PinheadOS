import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BizTaskCreateForm } from './BizTaskCreateForm';
import { useErpStore } from '../../store/useErpStore';

/**
 * ФОРМА СОЗДАНИЯ БИЗНЕС-ЗАДАЧИ (правки 19.10, п. 7).
 *
 * Обязательное — название, заказ, тип, ответственный, срок; блок кнопки
 * объясняет себя перечнем ТОЛЬКО незаполненного. Заказ во вкладке заказа
 * подставлен и не меняется. Двойной клик «Создать задачу» — один вызов.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));

const PEOPLE = [
  { user_id: 'u-petrov', name: 'Петров Пётр', email: 'petrov@x.ru', role: 'purchaser', department_id: null },
  { user_id: 'u-sidorova', name: 'Сидорова Анна', email: 'anna@x.ru', role: 'manager', department_id: null },
  // Без карточки сотрудника ERP — ответственным быть не может (сервер откажет)
  { user_id: 'u-sales', name: 'Продавцов Иван', email: 'sales@x.ru', role: null, department_id: null },
];

const ORDER = { id: 'o1', label: '№4821 · Худи «Ромашка»' };

function setup(over = {}) {
  const attachBizTaskFiles = vi.fn(async () => ({ id: 't-new' }));
  const onCreated = vi.fn();
  useErpStore.setState({
    chatDirectory: PEOPLE,
    chatDirectoryLoaded: true,
    loadChatDirectory: vi.fn(async () => {}),
    createBizTask: vi.fn(async (input) => ({ id: 't-new', ...input, status: 'new' })),
    attachBizTaskFiles,
    ...over,
  });
  render(<BizTaskCreateForm order={ORDER} onCreated={onCreated} onCancel={() => {}} />);
  return { createBizTask: useErpStore.getState().createBizTask, attachBizTaskFiles, onCreated };
}

function createButton() {
  return screen.getByRole('button', { name: 'Создать задачу' });
}

function pick(field, query, name) {
  const input = screen.getByRole('combobox', { name: field });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.mouseDown(screen.getByRole('option', { name: new RegExp(name) }));
}

function fillAll() {
  fireEvent.change(screen.getByRole('textbox', { name: /Название/ }), { target: { value: 'Заказать молнии' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Закупка' }));
  pick('Ответственный', 'Пет', 'Петров');
  fireEvent.change(screen.getByLabelText(/Срок/), { target: { value: '2099-10-20T18:00' } });
}

beforeEach(() => {
  Object.values(toast).forEach((f) => f.mockClear());
});

describe('BizTaskCreateForm', () => {
  it('незаполненные поля — aria-disabled и перечень только незаполненного', () => {
    const { createBizTask } = setup();
    expect(createButton()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Заполните: название, тип, ответственный, срок')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: /Название/ }), { target: { value: 'Забрать ткань' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Доставка' }));
    expect(screen.getByText('Заполните: ответственный, срок')).toBeInTheDocument();

    fireEvent.click(createButton());
    expect(createBizTask).not.toHaveBeenCalled();

    pick('Ответственный', 'Сид', 'Сидорова');
    fireEvent.change(screen.getByLabelText(/Срок/), { target: { value: '2099-10-20T18:00' } });
    expect(createButton()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/^Заполните:/)).toBeNull();
  });

  it('заказ подставлен и не меняется во вкладке заказа', async () => {
    const { createBizTask, onCreated } = setup();
    expect(screen.getByText(ORDER.label)).toBeInTheDocument();
    // Поля выбора заказа нет вовсе — ни списка, ни ввода
    expect(screen.queryByRole('combobox', { name: /Заказ/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Заказ/ })).toBeNull();

    fillAll();
    fireEvent.click(createButton());
    await waitFor(() => expect(createBizTask).toHaveBeenCalledTimes(1));
    const [input, key] = createBizTask.mock.calls[0];
    expect(input).toEqual({
      order_id: 'o1',
      title: 'Заказать молнии',
      kind: 'purchase',
      assignee_id: 'u-petrov',
      due_at: '2099-10-20T15:00:00.000Z',
      review_required: false,
    });
    expect(typeof key).toBe('string');
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 't-new' })));
    expect(toast.success).toHaveBeenCalledWith('Задача создана');
  });

  it('ответственным предлагаются только сотрудники ERP', () => {
    setup();
    const input = screen.getByRole('combobox', { name: 'Ответственный' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Продав' } });
    expect(screen.queryByRole('option', { name: /Продавцов/ })).toBeNull();
  });

  it('«Доставка» — подсказки «Откуда, Куда…»', () => {
    setup();
    expect(screen.queryByText(/Откуда/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Доставка' }));
    expect(screen.getByText('В описании укажите: Откуда, Куда, Контакт, Груз, Время')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Закупка' }));
    expect(screen.getByText('В описании укажите: Материал, Количество, Единица, Поставщик, Нужная дата'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Другое' }));
    expect(screen.queryByText(/В описании укажите/)).toBeNull();
  });

  it('двойной клик «Создать задачу» — один вызов', async () => {
    const { createBizTask } = setup({ createBizTask: vi.fn(() => new Promise(() => {})) });
    fillAll();
    fireEvent.click(createButton());
    fireEvent.click(createButton());
    await waitFor(() => expect(createBizTask).toHaveBeenCalledTimes(1));
  });

  it('срок в прошлом — предупреждение, но не блок', () => {
    setup();
    fillAll();
    fireEvent.change(screen.getByLabelText(/Срок/), { target: { value: '2001-01-01T10:00' } });
    expect(screen.getByText('Срок уже прошёл')).toBeInTheDocument();
    expect(createButton()).not.toHaveAttribute('aria-disabled');
  });

  it('дополнительные поля свёрнуты; наблюдатели, чек-лист и проверка уезжают в задачу', async () => {
    const { createBizTask } = setup();
    expect(screen.queryByRole('textbox', { name: 'Описание' })).toBeNull();
    fillAll();
    const more = screen.getByRole('button', { name: /Дополнительно/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: 'Описание' }), { target: { value: 'Молнии 20 см' } });
    pick('Наблюдатели', 'Сид', 'Сидорова');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить пункт' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Пункт 1' }), { target: { value: 'Согласовать цвет' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Проверка постановщиком' }));

    fireEvent.click(createButton());
    await waitFor(() => expect(createBizTask).toHaveBeenCalledTimes(1));
    expect(createBizTask.mock.calls[0][0]).toMatchObject({
      description: 'Молнии 20 см',
      watchers: ['u-sidorova'],
      checklist: ['Согласовать цвет'],
      review_required: true,
    });
  });
});
