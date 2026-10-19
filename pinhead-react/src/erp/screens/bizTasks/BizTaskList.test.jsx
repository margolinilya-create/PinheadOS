import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BizTaskList } from './BizTaskList';

/**
 * СТРОКА БИЗНЕС-ЗАДАЧИ (правки 19.10, п. 7): название, тип, ответственный,
 * срок, статус, отметка просрочки ТЕКСТОМ и число непрочитанных. Вся строка —
 * ссылка на карточку, и её доступное имя несёт всё это, включая «Просрочена»
 * (Global Constraints: бейдж входит в доступное имя строки).
 */

const NOW = new Date('2026-10-21T12:00:00Z');

const TASK = (over = {}) => ({
  id: 't1', order_id: 'o1', title: 'Заказать молнии', kind: 'purchase', description: null,
  assignee_id: 'u-petrov', creator_id: 'u-me', due_at: '2026-10-20T15:00:00.000Z',
  status: 'in_progress', review_required: false, pause_reason: null, cancel_reason: null,
  return_reason: null, result_text: null, result_message_id: null, submitted_at: null,
  reviewed_at: null, completed_at: null, cancelled_at: null, client_key: null,
  created_at: '2026-10-19T08:00:00Z', updated_at: '2026-10-19T08:00:00Z',
  watchers: [], order: { id: 'o1', bitrix_id: '4821', title: 'Худи' },
  ...over,
});

const NAMES = new Map([['u-petrov', 'Петров Пётр'], ['u-me', 'Иванова Мария']]);

function renderList(props) {
  return render(
    <MemoryRouter>
      <BizTaskList names={NAMES} unread={{}} now={NOW} {...props} />
    </MemoryRouter>,
  );
}

describe('BizTaskList', () => {
  it('строка: название, тип, ответственный, срок, статус, «Просрочена» текстом, непрочитанные', () => {
    renderList({ tasks: [TASK()], unread: { t1: 2 } });
    const row = screen.getByRole('link', { name: /Заказать молнии/ });
    expect(row).toHaveAttribute('href', '/biz-tasks/t1');
    const name = row.textContent;
    expect(name).toContain('Закупка');
    expect(name).toContain('Петров Пётр');
    expect(name).toContain('до 20.10, 18:00 МСК');
    expect(name).toContain('В работе');
    expect(within(row).getByText('Просрочена')).toBeInTheDocument();
    expect(row).toHaveAccessibleName(/Просрочена/);
    expect(row).toHaveAccessibleName(/Непрочитанных сообщений: 2/);
  });

  it('в срок и без непрочитанного — ни отметки, ни счётчика', () => {
    renderList({ tasks: [TASK({ due_at: '2026-10-25T15:00:00.000Z' })] });
    const row = screen.getByRole('link', { name: /Заказать молнии/ });
    expect(within(row).queryByText('Просрочена')).toBeNull();
    expect(row).not.toHaveAccessibleName(/Непрочитанных/);
  });

  it('заказ и постановщик — только в общем разделе', () => {
    const { unmount } = renderList({ tasks: [TASK()] });
    expect(screen.getByRole('link', { name: /Заказать молнии/ }).textContent).not.toContain('Иванова Мария');
    unmount();
    renderList({ tasks: [TASK()], showOrder: true });
    const row = screen.getByRole('link', { name: /Заказать молнии/ });
    expect(row.textContent).toContain('№4821');
    expect(row.textContent).toContain('Иванова Мария');
  });

  it('неизвестный ответственный не роняет строку', () => {
    renderList({ tasks: [TASK({ assignee_id: 'u-gone' })] });
    expect(screen.getByRole('link', { name: /Заказать молнии/ }).textContent).toContain('—');
  });
});
