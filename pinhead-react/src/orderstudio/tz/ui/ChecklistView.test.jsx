import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChecklistView from './ChecklistView';

const it_ = (id, blocking, text, href = null) => ({ id, ok: false, blocking, text, href });

describe('ChecklistView', () => {
  it('блокирующие сверху, со ссылкой «Исправить» на место правки; первый принимает фокус', () => {
    const ref = { current: null };
    render(
      <MemoryRouter>
        <ChecklistView
          firstRef={ref}
          items={[
            it_('margin', false, 'Маржа 10 % ниже порога 25 %'),
            it_('client', true, 'Укажите клиента', '?tab=client'),
            it_('ok', true, 'Готово', null),
          ].map((x) => (x.id === 'ok' ? { ...x, ok: true } : x))}
        />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Нужно исправить: Укажите клиента');
    expect(rows[1]).toHaveTextContent('Обратите внимание: Маржа 10 % ниже порога 25 %');
    expect(screen.getByRole('link', { name: 'Исправить' })).toHaveAttribute('href', '/?tab=client');
    expect(ref.current).toBe(rows[0]);
    expect(rows[0]).toHaveAttribute('tabindex', '-1');
  });

  it('пусто — «Чек-лист пройден»', () => {
    render(<MemoryRouter><ChecklistView items={[]} /></MemoryRouter>);
    expect(screen.getByText('Чек-лист пройден — заказ готов к отправке')).toBeInTheDocument();
  });
});
