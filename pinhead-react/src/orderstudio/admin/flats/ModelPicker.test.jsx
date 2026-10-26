import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ModelPicker from './ModelPicker';

const SKUS = [
  { code: 'T-001', name: 'Футболка базовая', category: 'tshirts' },
  { code: 'H-002', name: 'Худи базовое', category: 'hoodies' },
];

describe('ModelPicker — модели только категорий флэта (веха 5в)', () => {
  it('у флэта футболок поиск не предлагает худи', () => {
    render(<ModelPicker id="m" label="Модели" skus={SKUS} categories={['tshirts']} value={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Модели'), { target: { value: 'базов' } });
    expect(screen.getByRole('button', { name: 'T-001 — Футболка базовая' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /H-002/ })).toBeNull();
  });
  it('категорий у флэта нет — предлагаются все модели', () => {
    render(<ModelPicker id="m" label="Модели" skus={SKUS} categories={[]} value={[]} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Модели'), { target: { value: 'базов' } });
    expect(screen.getAllByRole('button', { name: /базов/ })).toHaveLength(2);
  });
});
