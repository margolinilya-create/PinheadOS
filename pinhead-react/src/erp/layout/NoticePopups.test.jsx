import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NoticePopups } from './NoticePopups';
import { useErpStore } from '../store/useErpStore';

/**
 * ВСПЛЫВАЮЩИЕ УВЕДОМЛЕНИЯ (правка заказчика 20.09, п. 4) — показ.
 *
 * Очередь считает слайс (`utils/noticePopups` со своими тестами), здесь
 * проверяется то, за что отвечает разметка: переход гасит уведомление
 * и ведёт К СООБЩЕНИЮ, а по заказу с открытым окном чата карточка
 * не всплывает вовсе — человек читает эту переписку прямо сейчас.
 */

const N = (over = {}) => ({
  id: 'n1',
  user_id: 'u1',
  kind: 'chat_message',
  order_id: 'o1',
  title: 'Мария в заказе 4821',
  body: 'Ткань приехала',
  link: '/orders/o1?tab=chat&msg=m1',
  created_at: '2026-09-20T10:00:00Z',
  read_at: null,
  ...over,
});

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigate,
}));

beforeEach(() => {
  navigate.mockClear();
  useErpStore.setState({
    noticePopups: [N()],
    chatWindow: null,
    dismissNoticePopup: vi.fn(),
    markNotificationsRead: vi.fn(async () => true),
  });
});

const show = () => render(<MemoryRouter><NoticePopups /></MemoryRouter>);

describe('всплывающие уведомления', () => {
  it('показывают заголовок и текст', () => {
    show();
    expect(screen.getByText('Мария в заказе 4821')).toBeInTheDocument();
    expect(screen.getByText('Ткань приехала')).toBeInTheDocument();
  });

  it('нажатие гасит уведомление и ведёт по ссылке — к сообщению', () => {
    show();
    fireEvent.click(screen.getByText('Мария в заказе 4821'));
    const s = useErpStore.getState();
    expect(s.markNotificationsRead).toHaveBeenCalledWith(['n1']);
    expect(navigate).toHaveBeenCalledWith('/orders/o1?tab=chat&msg=m1');
    expect(s.dismissNoticePopup).toHaveBeenCalledWith('n1');
  });

  it('закрытие крестиком не отмечает прочитанным', () => {
    show();
    fireEvent.click(screen.getByLabelText('Закрыть уведомление'));
    const s = useErpStore.getState();
    expect(s.dismissNoticePopup).toHaveBeenCalledWith('n1');
    // Убрать с глаз и прочитать — разное: непрочитанное остаётся в центре
    expect(s.markNotificationsRead).not.toHaveBeenCalled();
  });

  /**
   * Карточка поверх открытой переписки сообщала бы о том, что у человека
   * перед глазами. Само уведомление при этом остаётся в центре — гасить
   * его за человека нельзя.
   */
  it('по заказу с открытым окном чата не всплывает', () => {
    useErpStore.setState({ chatWindow: { orderId: 'o1', title: '4821', context: {} } });
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });

  it('по ДРУГОМУ заказу всплывает и при открытом чате', () => {
    useErpStore.setState({ chatWindow: { orderId: 'o2', title: '4822', context: {} } });
    show();
    expect(screen.getByText('Мария в заказе 4821')).toBeInTheDocument();
  });

  it('пустая очередь не рисует контейнер', () => {
    useErpStore.setState({ noticePopups: [] });
    const { container } = show();
    expect(container).toBeEmptyDOMElement();
  });
});
