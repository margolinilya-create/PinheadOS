import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RollFinishModal } from './RollFinishModal';

/**
 * ЗАВЕРШЕНИЕ РУЛОНА ВЫНЕСЕНО ИЗ ФОРМЫ ЗАПИСИ РЕЗУЛЬТАТА (правка 05.10, п. 5):
 * «остаток, поле измеренного метража, выбор „оставить пригодный остаток /
 * списать непригодный" — ничего не выбирать за пользователя».
 */

const OPTION = {
  roll: {
    id: 'r1', seq: 1, label: 'Рулон №1', status: 'in_use', qty: 50,
    length_m: 111.11, length_source: 'calc', length_left_m: 71.11, leftover_kind: null,
  },
  material: { id: 'm1', name: 'Футер', color: 'чёрный', width_cm: 180, density_gsm: 250 },
  label: 'Рулон №1 · Футер · чёрный',
};

const renderModal = (onFinish = vi.fn(async () => true), onClose = vi.fn()) => {
  render(<RollFinishModal option={OPTION} itemId="it1" onFinish={onFinish} onClose={onClose} />);
  return { onFinish, onClose };
};

describe('окно «Завершить рулон»', () => {
  it('показывает остаток по записям; выбор судьбы не сделан за человека', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /Завершить рулон/ })).toBeInTheDocument();
    expect(screen.getByText(/Остаток по записям/)).toHaveTextContent('Остаток по записям: 71,11 м · исходный метраж 111,11 м (расчёт) · записано расходом 40,00 м');
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Завершить рулон' })).toBeDisabled();
    expect(screen.getByText(/Выберите, что сделать с остатком/)).toBeInTheDocument();
  });

  it('пригодный остаток — остаётся доступным, замер не уточняется', async () => {
    const { onFinish, onClose } = renderModal();
    fireEvent.click(screen.getByRole('radio', { name: /Оставить пригодный остаток/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить рулон' }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onFinish).toHaveBeenCalledWith('r1', {
      kind: 'usable', itemId: 'it1', refineLengthM: null, reason: null,
    });
  });

  it('измеренный остаток уезжает уточнением вместе с причиной, списание — непригодный', async () => {
    const { onFinish } = renderModal();
    fireEvent.change(screen.getByLabelText('Измеренный остаток, м'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('Причина расхождения'), { target: { value: 'перемерили' } });
    fireEvent.click(screen.getByRole('radio', { name: /Списать непригодный/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить рулон' }));
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalled());
    const [, opts] = onFinish.mock.calls[0];
    expect(opts.kind).toBe('scrap');
    expect(opts.refineLengthM).toBeCloseTo(110, 2);
    expect(opts.reason).toBe('перемерили');
  });

  it('замер без причины не завершает рулон; Escape окно не закрывает (QA 09.10)', () => {
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Измеренный остаток, м'), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('radio', { name: /Списать непригодный/ }));
    expect(screen.getByRole('button', { name: 'Завершить рулон' })).toBeDisabled();
    expect(screen.getByText(/укажите причину расхождения/)).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Измеренный остаток, м')).toHaveValue(70);
  });

  it('двойной клик не завершает рулон дважды', async () => {
    let resolve;
    const onFinish = vi.fn(() => new Promise((r) => { resolve = r; }));
    renderModal(onFinish);
    fireEvent.click(screen.getByRole('radio', { name: /Оставить пригодный остаток/ }));
    const button = screen.getByRole('button', { name: 'Завершить рулон' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onFinish).toHaveBeenCalledTimes(1);
    resolve(true);
  });

  it('отказ сервера — окно не закрывается, введённое остаётся', async () => {
    const { onClose } = renderModal(vi.fn(async () => false));
    fireEvent.click(screen.getByRole('radio', { name: /Списать непригодный/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Завершить рулон' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Завершить рулон' })).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
