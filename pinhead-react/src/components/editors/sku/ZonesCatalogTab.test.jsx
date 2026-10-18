import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ZonesCatalogTab from './ZonesCatalogTab';

const zones = [
  { id: 'back', name: 'Спина', forCategories: null, sortOrder: 2 },
  { id: 'front', name: 'Грудь', forCategories: null, sortOrder: 1 },
  { id: 'hood', name: 'Капюшон', forCategories: ['hoodies'], sortOrder: 3, tz_row: 'hood_l', active: false },
];

function renderTab(list = zones) {
  return render(
    <MemoryRouter>
      <ZonesCatalogTab zonesCatalog={list} />
    </MemoryRouter>,
  );
}

describe('ZonesCatalogTab — только просмотр (веха 5б, задача 4)', () => {
  it('таблица зон по порядку: id, название, категории, строка ТЗ, подбор', () => {
    renderTab();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['front', 'back', 'hood']);
    expect(rows[0]).toHaveTextContent('Грудь');
    expect(rows[0]).toHaveTextContent('все');
    expect(rows[0]).toHaveTextContent('Полочка');
    expect(rows[2]).toHaveTextContent('Худи');
    expect(rows[2]).toHaveTextContent('Капюшон Л');
    expect(rows[2]).toHaveTextContent('снята');
  });

  it('ни полей, ни кнопок добавления и удаления', () => {
    renderTab();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByLabelText('Удалить зону')).toBeNull();
  });

  it('ссылка на новое место правки — «Справочники заказа» → «Флэты и зоны»', () => {
    renderTab();
    const link = screen.getByRole('link', { name: /Флэты и зоны/ });
    expect(link).toHaveAttribute('href', '/order-settings?tab=flats&part=zones');
  });

  it('пустой справочник — текст вместо таблицы', () => {
    renderTab([]);
    expect(screen.getByText('Зон нанесения пока нет')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
