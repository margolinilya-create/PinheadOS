import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WarehouseTaskCard } from './WarehouseTaskCard';

/**
 * Карточка задачи склада (компактная раскладка).
 *
 * Правка владельца, п. 2 «Подсветка нерабочих элементов»: заголовок
 * «№ · название заказа» подсвечивался под курсором, как ссылка, а клик
 * не делал ничего. Теперь он ведёт в карточку заказа; задачу открывает
 * по-прежнему кнопка «Открыть».
 */
function renderCard(patch = {}) {
  const onOpen = vi.fn();
  render(
    <MemoryRouter>
      <WarehouseTaskCard
        taskId="t1"
        typeLabel="Приёмка материалов"
        typeIcon="box"
        orderId="o1"
        orderNo="4821"
        orderTitle="Худи «Ромашка»"
        statusLabel="Ожидает"
        statusVariant="neutral"
        fields={[
          { label: 'Содержимое', value: 'Футер' },
          { label: 'Срок', value: '30.08' },
        ]}
        onOpen={onOpen}
        {...patch}
      />
    </MemoryRouter>,
  );
  return { onOpen };
}

describe('карточка задачи склада', () => {
  it('заголовок — ссылка на карточку заказа', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /№4821 · Худи «Ромашка»/ });
    expect(link).toHaveAttribute('href', '/orders/o1');
  });

  it('без id заказа заголовок остаётся текстом, а не мёртвой ссылкой', () => {
    renderCard({ orderId: undefined });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/№4821 · Худи «Ромашка»/)).toBeInTheDocument();
  });

  it('«Открыть» по-прежнему открывает задачу', () => {
    const { onOpen } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Обработчик списка общий на все карточки — задачу называет сама карточка
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  /**
   * Правка 05.10, п. 8: «везде одинаковое „Открыть"». Кнопка называет
   * операцию и открывает форму — сама операция не проводится.
   */
  it('кнопка называет операцию задачи', () => {
    const { onOpen } = renderCard({ actionLabel: 'Принять ткань' });
    fireEvent.click(screen.getByRole('button', { name: 'Принять ткань' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('поле может нести пояснение — срок заказа рядом со сроком поставки', () => {
    renderCard({ fields: [{ label: 'Срок поставки', value: 'не задан', note: 'срок заказа 20.10.2026' }] });
    expect(screen.getByText('не задан')).toBeInTheDocument();
    expect(screen.getByText('срок заказа 20.10.2026')).toBeInTheDocument();
  });
});
