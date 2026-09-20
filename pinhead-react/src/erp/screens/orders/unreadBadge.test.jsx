import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OrderRow } from './OrderRow';
import { OrderCardMobile } from './OrderCardMobile';

/**
 * НЕПРОЧИТАННОЕ ПЕРЕПИСКИ В СПИСКЕ ЗАКАЗОВ (правка заказчика 20.09, п. 4).
 *
 * «На вкладке и кнопке чата, а также в списке заказов показывать число
 * непрочитанных сообщений для текущего пользователя. При нуле скрывать
 * бейдж».
 *
 * Сторож смотрит ОБЕ раскладки: таблица живёт на компьютере, карточка —
 * на планшете цеха, и правка, доехавшая до одной из двух, сделана наполовину
 * (правило раздела «Планшет цеха, раскладка, офлайн»).
 */

const DEPT = {
  id: 'd1', code: 'sewing', name: 'Швейный цех',
  is_production: true, active: true, sort_order: 1, gate_material_kinds: [],
};

const ORDER = {
  id: 'o1',
  bitrix_id: '63634',
  title: 'Одноклассники сентябрь',
  status: 'active',
  manager: 'Никита',
  due_date: '2026-09-30',
  created_at: '2026-09-01T09:00:00Z',
  shipped_at: null,
  delivered_at: null,
  notes: null,
  procurement_tasks: [],
  items: [{
    id: 'i1', order_id: 'o1', product_type: 'Худи', variant: null, qty: 30,
    production_type: 'sewing', branding_methods: [], stages: [], prints: [],
  }],
};

const renderRow = (chatUnread) => render(
  <MemoryRouter>
    <table><tbody>
      <OrderRow
        order={ORDER}
        departments={[DEPT]}
        now={null}
        onDelete={() => {}}
        canDelete={false}
        onShip={null}
        chatUnread={chatUnread}
      />
    </tbody></table>
  </MemoryRouter>,
);

const renderCard = (chatUnread) => render(
  <MemoryRouter>
    <OrderCardMobile
      order={ORDER}
      departments={[DEPT]}
      now={null}
      onDelete={() => {}}
      canDelete={false}
      onShip={null}
      chatUnread={chatUnread}
    />
  </MemoryRouter>,
);

describe('счётчик непрочитанных в списке заказов', () => {
  it('строка таблицы показывает число', () => {
    renderRow(3);
    expect(screen.getByTitle('Непрочитанных сообщений: 3')).toBeInTheDocument();
  });

  it('карточка планшета показывает то же число', () => {
    renderCard(3);
    expect(screen.getByTitle('Непрочитанных сообщений: 3')).toBeInTheDocument();
  });

  /**
   * Ноль — не «пусто», а «читать нечего»: пилюля с нулём просила бы внимания
   * зря, и документ требует её скрывать. Проверяется в обеих раскладках,
   * потому что прячут её два разных куска разметки.
   */
  it('при нуле бейдж не рендерится ни в строке, ни в карточке', () => {
    const row = renderRow(0);
    expect(row.container.textContent).not.toMatch(/Непрочитанных сообщений/);
    row.unmount();
    const card = renderCard(0);
    expect(card.container.textContent).not.toMatch(/Непрочитанных сообщений/);
  });

  /** Значение по умолчанию — тоже ноль: экран без счётчика не рисует пилюлю */
  it('без переданного счётчика бейджа нет', () => {
    render(
      <MemoryRouter>
        <OrderCardMobile
          order={ORDER}
          departments={[DEPT]}
          now={null}
          onDelete={() => {}}
          canDelete={false}
          onShip={null}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByTitle(/Непрочитанных сообщений/)).not.toBeInTheDocument();
  });
});
