import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BizTaskActionDialog } from './BizTaskActionDialog';
import { actionDialogText } from './bizTaskCardView';

/**
 * ДИАЛОГ ДЕЙСТВИЯ ЗАДАЧИ (правки 19.10, п. 7): переход с обязательным текстом —
 * причина, что исправить, результат. Пустой текст не уходит писателю: кнопка
 * `aria-disabled` с причиной, а не молчаливый отказ 22023 с сервера.
 */

const done = (n, total) => Array.from({ length: total }, (_, i) => ({ done: i < n }));

describe('actionDialogText', () => {
  it('тексты отмены, возврата и приостановки — дословно', () => {
    expect(actionDialogText('cancel', [])).toEqual({
      title: 'Отменить задачу?', field: 'Причина', confirm: 'Отменить задачу', cancel: 'Не отменять',
    });
    expect(actionDialogText('return', [])).toMatchObject({
      title: 'Вернуть в работу?', field: 'Что исправить', confirm: 'Вернуть в работу',
    });
    expect(actionDialogText('pause', [])).toMatchObject({
      title: 'Приостановить задачу?', field: 'Причина', confirm: 'Приостановить',
    });
  });

  it('завершение с невыполненными пунктами — предупреждение и «Вернуться к чек-листу»', () => {
    expect(actionDialogText('complete', done(3, 5))).toEqual({
      title: 'Не выполнено 2 пункта чек-листа из 5. Завершить?',
      field: 'Результат',
      confirm: 'Завершить',
      cancel: 'Вернуться к чек-листу',
    });
    expect(actionDialogText('complete', done(4, 5)).title).toBe('Не выполнено 1 пункт чек-листа из 5. Завершить?');
    expect(actionDialogText('complete', done(5, 5)).title).toBe('Завершить задачу?');
  });

  it('переходы без текста диалога не имеют', () => {
    expect(actionDialogText('start', [])).toBeNull();
    expect(actionDialogText('accept', [])).toBeNull();
  });
});

describe('BizTaskActionDialog', () => {
  it('пустой текст не отправляется; введённый уходит обрезанным', async () => {
    const onConfirm = vi.fn(async () => true);
    const onClose = vi.fn();
    render(<BizTaskActionDialog text={actionDialogText('cancel', [])} onConfirm={onConfirm} onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Отменить задачу?' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Отменить задачу' });
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Укажите: причина')).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: '  Клиент передумал  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить задачу' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Клиент передумал'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('отказ писателя — окно с текстом остаётся', async () => {
    const onConfirm = vi.fn(async () => false);
    const onClose = vi.fn();
    render(<BizTaskActionDialog text={actionDialogText('return', [])} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/Что исправить/), { target: { value: 'Нет накладной' } });
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в работу' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Что исправить/)).toHaveValue('Нет накладной');
  });

  it('«Не отменять» закрывает окно без вызова', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<BizTaskActionDialog text={actionDialogText('cancel', [])} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Не отменять' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('результат подставляется прежним текстом', () => {
    render(
      <BizTaskActionDialog
        text={actionDialogText('complete', [])}
        initial="Доставлено на склад"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Результат/)).toHaveValue('Доставлено на склад');
  });
});
