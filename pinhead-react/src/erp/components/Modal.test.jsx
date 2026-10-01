import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

/**
 * Окно-справка закрывается промахом мимо панели и Escape, форма ввода — нет
 * (правка заказчика 01.10, п. 3: «клик вне формы не должен её закрывать:
 * всё заполненное остаётся»).
 */
function renderModal(props = {}) {
  const onClose = vi.fn();
  render(
    <Modal title="Окно" onClose={onClose} {...props}>
      <input aria-label="Поле" />
    </Modal>,
  );
  const overlay = screen.getByRole('dialog').parentElement;
  return { onClose, overlay };
}

describe('Modal', () => {
  it('по умолчанию клик по оверлею и Escape закрывают окно', () => {
    const { onClose, overlay } = renderModal();
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('клик внутри панели окно не закрывает', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByLabelText('Поле'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closeOnOverlay={false}: клик мимо панели окно не закрывает, ввод на месте', () => {
    const { onClose, overlay } = renderModal({ closeOnOverlay: false });
    fireEvent.change(screen.getByLabelText('Поле'), { target: { value: 'набранное' } });
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Поле')).toHaveValue('набранное');
  });

  it('closeOnEscape={false}: Escape окно не закрывает', () => {
    const { onClose } = renderModal({ closeOnOverlay: false, closeOnEscape: false });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
