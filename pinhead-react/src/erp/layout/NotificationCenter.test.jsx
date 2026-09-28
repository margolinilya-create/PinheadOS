import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationCenter } from './NotificationCenter';
import { useErpStore } from '../store/useErpStore';

/**
 * ЦЕНТР ПОКАЗЫВАЕТ ТО, ЧТО КОЛОКОЛ ПОСЧИТАЛ (28.09).
 *
 * Бейдж складывает производственные поводы (`orderNotices`) и личные
 * непрочитанные, а центр рисовал только личные: на бейдже «1», внутри
 * «Непрочитанных нет». Здесь проверяется, что поводы бейджа видны в центре.
 */

const alert = (over = {}) => ({
  id: 'o-o1', orderId: 'o1', kind: 'overdue',
  text: 'Просрочен заказ №4821', sub: 'Худи', overdueDays: 3, ...over,
});

beforeEach(() => {
  useErpStore.setState({ notifications: [], markNotificationsRead: vi.fn(async () => true) });
});

const show = (alerts, onClose = vi.fn()) => render(
  <MemoryRouter><NotificationCenter alerts={alerts} onClose={onClose} /></MemoryRouter>,
);

describe('центр уведомлений', () => {
  it('показывает производственный повод, посчитанный в бейдже', () => {
    show([alert()]);
    expect(screen.getByText('Требуют внимания · 1')).toBeInTheDocument();
    expect(screen.getByText(/Просрочен заказ №4821/)).toBeInTheDocument();
    expect(screen.getByText('Личных непрочитанных нет')).toBeInTheDocument();
  });

  it('повод ведёт к заказу и закрывает центр', () => {
    const onClose = vi.fn();
    show([alert()], onClose);
    const link = screen.getByText(/Просрочен заказ №4821/).closest('a');
    expect(link.getAttribute('href')).toContain('o1');
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('на «Упоминаниях» поводов нет — они не про чат', () => {
    show([alert()]);
    fireEvent.click(screen.getByText('Упоминания'));
    expect(screen.queryByText(/Просрочен заказ/)).toBeNull();
  });

  it('без поводов и личных — прежнее «Непрочитанных нет»', () => {
    show([]);
    expect(screen.getByText('Непрочитанных нет')).toBeInTheDocument();
  });

  it('лимит не тихий: сколько показано и где остальные', () => {
    show(Array.from({ length: 10 }, (_, i) => alert({ id: `o-${i}`, orderId: `o${i}` })));
    expect(screen.getByText('Показаны 8 из 10 → все на обзоре')).toBeInTheDocument();
  });
});
