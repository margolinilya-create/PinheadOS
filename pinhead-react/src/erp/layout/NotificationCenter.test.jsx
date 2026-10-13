import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotificationCenter } from './NotificationCenter';
import { useErpStore } from '../store/useErpStore';

/**
 * ЦЕНТР УВЕДОМЛЕНИЙ (правка 20.09, п. 4; переразложен правкой 01.10, п. 4).
 *
 * Здесь проверяется то, что ломается молча:
 *
 *   · «в колокольчике личные сообщения нужно отделить от напоминаний
 *     о сроках» — два раздела со своими счётчиками;
 *   · «открытие колокольчика не отмечает сообщение прочитанным» — ни
 *     открытие центра, ни нажатие на строку ничего не гасят;
 *   · отметка руками («✓» и «Отметить все») — осталась;
 *   · звук и окно браузера — настройки сотрудника из стора, а не ключи
 *     localStorage устройства.
 */

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

const alert = (over = {}) => ({
  id: 'o-o1', orderId: 'o1', kind: 'overdue',
  text: 'Просрочен заказ №4821', sub: 'Худи', overdueDays: 3, ...over,
});

const N = (over = {}) => ({
  id: 'n1',
  user_id: 'u1',
  kind: 'chat_mention',
  order_id: 'o1',
  title: 'Вас упомянули — сделка 4821',
  body: 'Ткань приехала',
  link: '/orders/o1?tab=chat&msg=m1',
  message_id: 'm1',
  created_at: '2026-10-01T10:00:00Z',
  read_at: null,
  ...over,
});

let actions;
beforeEach(() => {
  navigate.mockClear();
  actions = {
    markNotificationsRead: vi.fn(async () => true),
    markAllNotificationsRead: vi.fn(async () => true),
    saveNoticeSettings: vi.fn(async () => true),
  };
  useErpStore.setState({
    notifications: [],
    notificationsUnread: 0,
    noticeSettings: { sound: true, desktop: false },
    ...actions,
  });
});

const show = (alerts, onClose = vi.fn()) => render(
  <MemoryRouter><NotificationCenter alerts={alerts} onClose={onClose} /></MemoryRouter>,
);

describe('центр уведомлений: два раздела', () => {
  it('у «Сообщений» и «Сроков» свои счётчики; сообщения — числом с сервера', () => {
    // В памяти одна строка, а непрочитанных на сервере 7: счётчик — серверный
    useErpStore.setState({ notifications: [N()], notificationsUnread: 7 });
    show([alert(), alert({ id: 'o-o2', orderId: 'o2' })]);
    expect(screen.getByRole('button', { name: 'Сообщения · 7' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сроки · 2' })).toBeInTheDocument();
  });

  it('сроки не смешиваются с личными: в «Сообщениях» их нет', () => {
    useErpStore.setState({ notifications: [N()], notificationsUnread: 1 });
    show([alert()]);
    expect(screen.getByText('Вас упомянули — сделка 4821')).toBeInTheDocument();
    expect(screen.queryByText(/Просрочен заказ/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Сроки/ }));
    expect(screen.getByText(/Просрочен заказ №4821/)).toBeInTheDocument();
    expect(screen.queryByText('Вас упомянули — сделка 4821')).toBeNull();
  });

  it('личных нет, а сроки горят — открывается раздел «Сроки»', () => {
    show([alert()]);
    expect(screen.getByRole('button', { name: /Сроки/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Просрочен заказ №4821/)).toBeInTheDocument();
  });

  it('повод по сроку ведёт к заказу и закрывает центр', () => {
    const onClose = vi.fn();
    show([alert()], onClose);
    const link = screen.getByText(/Просрочен заказ №4821/).closest('a');
    expect(link.getAttribute('href')).toContain('o1');
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('лимит сроков не тихий: сколько показано и где остальные', () => {
    show(Array.from({ length: 10 }, (_, i) => alert({ id: `o-${i}`, orderId: `o${i}` })));
    expect(screen.getByText('Показаны 8 из 10 → все на обзоре')).toBeInTheDocument();
  });

  it('пусто везде — «Непрочитанных сообщений нет»', () => {
    show([]);
    expect(screen.getByText('Непрочитанных сообщений нет')).toBeInTheDocument();
  });
});

describe('центр уведомлений: прочитанность', () => {
  it('открытие центра ничего не гасит', () => {
    useErpStore.setState({ notifications: [N()], notificationsUnread: 1 });
    show([]);
    expect(actions.markNotificationsRead).not.toHaveBeenCalled();
    expect(actions.markAllNotificationsRead).not.toHaveBeenCalled();
  });

  it('нажатие ведёт к сообщению и закрывает центр, но НЕ отмечает прочитанным', () => {
    useErpStore.setState({ notifications: [N()], notificationsUnread: 1 });
    const onClose = vi.fn();
    show([], onClose);
    fireEvent.click(screen.getByText('Вас упомянули — сделка 4821'));
    expect(navigate).toHaveBeenCalledWith('/orders/o1?tab=chat&msg=m1');
    expect(onClose).toHaveBeenCalled();
    expect(actions.markNotificationsRead).not.toHaveBeenCalled();
  });

  it('«✓» у строки отмечает именно её', () => {
    useErpStore.setState({ notifications: [N()], notificationsUnread: 1 });
    show([]);
    fireEvent.click(screen.getByRole('button', { name: 'Отметить прочитанным' }));
    expect(actions.markNotificationsRead).toHaveBeenCalledWith(['n1']);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('«Отметить все» — все на сервере, а не загруженные', () => {
    useErpStore.setState({ notifications: [N()], notificationsUnread: 60 });
    show([]);
    fireEvent.click(screen.getByText('Отметить все прочитанными'));
    expect(actions.markAllNotificationsRead).toHaveBeenCalled();
  });

  it('у прочитанной строки «✓» нет, а «Отметить все» при нуле не показывается', () => {
    useErpStore.setState({ notifications: [N({ read_at: '2026-10-01T10:05:00Z' })] });
    show([]);
    fireEvent.click(screen.getByText('Все'));
    expect(screen.queryByRole('button', { name: 'Отметить прочитанным' })).toBeNull();
    expect(screen.queryByText('Отметить все прочитанными')).toBeNull();
  });
});

describe('центр уведомлений: настройки сотрудника', () => {
  it('переключатели показывают настройку из стора и сохраняют в него', () => {
    show([]);
    const sound = screen.getByLabelText('Звук нового уведомления');
    expect(sound).toBeChecked();
    fireEvent.click(sound);
    expect(actions.saveNoticeSettings).toHaveBeenCalledWith({ sound: false });
  });

  it('окно браузера включается только с разрешением', async () => {
    const g = globalThis;
    g.Notification = { permission: 'default', requestPermission: vi.fn(async () => 'denied') };
    try {
      show([]);
      fireEvent.click(screen.getByLabelText('Уведомления браузера, пока ERP открыта'));
      await waitFor(() => expect(g.Notification.requestPermission).toHaveBeenCalled());
      expect(actions.saveNoticeSettings).not.toHaveBeenCalled();
      expect(await screen.findByText(/Браузер запретил уведомления/)).toBeInTheDocument();
    } finally {
      delete g.Notification;
    }
  });
});
