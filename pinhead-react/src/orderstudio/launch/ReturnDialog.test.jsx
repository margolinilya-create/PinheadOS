import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ReturnDialog, { RETURN_MAX } from './ReturnDialog';

describe('ReturnDialog', () => {
  it('фокус в поле причины; подсказка и счётчик связаны; счётчик объявляется с 450 знаков', () => {
    render(<ReturnDialog onSubmit={vi.fn()} onClose={vi.fn()} />);
    const field = screen.getByLabelText('Что исправить менеджеру');
    expect(document.activeElement).toBe(field);
    expect(field).toHaveAccessibleDescription(`Причину увидит менеджер в заказе 0 / ${RETURN_MAX}`);
    const counter = screen.getByText(`0 / ${RETURN_MAX}`);
    expect(counter).toHaveAttribute('aria-live', 'off');
    fireEvent.change(field, { target: { value: 'а'.repeat(450) } });
    expect(screen.getByText(`450 / ${RETURN_MAX}`)).toHaveAttribute('aria-live', 'polite');
    expect(field).toHaveAttribute('maxLength', String(RETURN_MAX));
  });

  it('пустая причина (пробелы) — «Вернуть с причиной» недоступна, RPC не зовётся', () => {
    const onSubmit = vi.fn();
    render(<ReturnDialog onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Что исправить менеджеру'), { target: { value: '   ' } });
    const btn = screen.getByRole('button', { name: 'Вернуть с причиной' });
    expect(btn).toBeDisabled();
    fireEvent.submit(btn.closest('form'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
