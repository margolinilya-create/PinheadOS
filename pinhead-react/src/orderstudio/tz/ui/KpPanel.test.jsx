import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { newSalesItem, newSalesOrder } from '../../model/factory';
import KpPanel, { MSG_KP_EMPTY } from './KpPanel';

const h = vi.hoisted(() => ({ build: vi.fn(), save: vi.fn() }));
vi.mock('../pdf/kpPdf', () => ({ buildKpPdf: h.build }));
vi.mock('../kp/kpMockups', () => ({ kpMockupLoader: () => async () => null }));
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: h.save }));

const PRICE = { items: [], subtotal: 0, prep_total: 0, discount_amount: 0, total: 0, cost_total: 0, margin: 0, margin_pct: 0, below_threshold: false, incomplete: false };

beforeEach(() => { h.build.mockReset(); h.save.mockReset(); });

describe('КП для клиента (веха 5в, Э6)', () => {
  it('без изделий — кнопка недоступна с причиной', () => {
    render(<KpPanel order={newSalesOrder({ number: 'PH-1' })} price={PRICE} catalogs={null} today="2026-10-26" />);
    const btn = screen.getByRole('button', { name: 'Скачать КП (PDF)' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription(MSG_KP_EMPTY);
    fireEvent.click(btn);
    expect(h.build).not.toHaveBeenCalled();
  });
  it('собирает и скачивает PH-…-KP.pdf; отказ с причиной — её текстом', async () => {
    h.build.mockResolvedValueOnce(new Blob(['%PDF']));
    const order = newSalesOrder({ number: 'PH-1234', items: [newSalesItem()] });
    render(<KpPanel order={order} price={PRICE} catalogs={null} today="2026-10-26" />);
    fireEvent.click(screen.getByRole('button', { name: 'Скачать КП (PDF)' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.any(Blob), 'PH-1234-KP.pdf'));
    h.build.mockRejectedValueOnce(Object.assign(new Error('в тексте есть знаки, которых нет в шрифте PDF: ☕'), { kp: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Скачать КП (PDF)' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('КП не собрано: в тексте есть знаки, которых нет в шрифте PDF: ☕');
  });
});
