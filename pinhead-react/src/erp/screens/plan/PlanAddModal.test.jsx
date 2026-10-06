import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(), rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(async () => 'ok'),
    functions: { invoke: vi.fn() },
  },
}));

const { PlanAddModal } = await import('./PlanAddModal');
const { useErpStore } = await import('../../store/useErpStore');

/**
 * Постановка в план — форма ввода (день, количество, комментарий), поэтому
 * закрывается только своей кнопкой (правка 01.10, п. 3). Клик мимо панели
 * сняли тогда же, а Escape окно по-прежнему закрывал: руководитель терял
 * набранный комментарий одной клавишей.
 */

beforeEach(() => {
  useErpStore.setState({
    orders: [], departments: [], bypasses: [], planSlots: [], planStage: vi.fn(),
  });
});

describe('PlanAddModal — закрытие', () => {
  it('Escape окно не закрывает', () => {
    const onClose = vi.fn();
    render(<PlanAddModal date="2026-10-06" departmentId={null} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('клик по затемнению окно не закрывает', () => {
    const onClose = vi.fn();
    const { container } = render(
      <PlanAddModal date="2026-10-06" departmentId={null} onClose={onClose} />,
    );

    fireEvent.click(container.firstChild);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('✕ закрывает', () => {
    const onClose = vi.fn();
    render(<PlanAddModal date="2026-10-06" departmentId={null} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));

    expect(onClose).toHaveBeenCalled();
  });
});
