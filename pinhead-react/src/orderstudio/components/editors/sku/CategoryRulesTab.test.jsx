import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CategoryRulesTab from './CategoryRulesTab';

const emptyRules = [];
const mockExtras = [
  { code: 'overlock', name: 'Обметка', price: 30 },
  { code: 'wash-label', name: 'Этикетка', price: 15 },
];
const mockZones = [
  { id: 'front', name: 'Грудь', forCategories: null, sortOrder: 1 },
  { id: 'back', name: 'Спина', forCategories: null, sortOrder: 2 },
  { id: 'sleeve-l', name: 'Лев. рукав', forCategories: null, sortOrder: 3 },
  { id: 'sleeve-r', name: 'Прав. рукав', forCategories: null, sortOrder: 4 },
  { id: 'hood', name: 'Капюшон', forCategories: ['hoodies','ziphoodies','halfzips'], sortOrder: 5 },
  { id: 'pocket', name: 'Карман', forCategories: null, sortOrder: 6 },
];

function renderTab(rules = emptyRules, onUpdate = vi.fn()) {
  return {
    onUpdate,
    ...render(
      <CategoryRulesTab
        categoryRules={rules}
        extrasCatalog={mockExtras}
        zonesCatalog={mockZones}
        onUpdate={onUpdate}
      />
    ),
  };
}

describe('CategoryRulesTab', () => {
  it('renders all 11 categories', () => {
    renderTab();
    expect(screen.getByText('Футболки')).toBeInTheDocument();
    expect(screen.getByText('Худи')).toBeInTheDocument();
    expect(screen.getByText('Аксессуары')).toBeInTheDocument();
  });

  it('shows "без ограничений" badge for categories with no rules', () => {
    renderTab();
    const badges = screen.getAllByText('без ограничений');
    expect(badges.length).toBe(11);
  });

  it('expands a category on click', () => {
    renderTab();
    fireEvent.click(screen.getByText('Футболки'));
    expect(screen.getByText('ТЕХНИКИ НАНЕСЕНИЯ')).toBeInTheDocument();
    expect(screen.getByText('МИНИМАЛЬНЫЙ ТИРАЖ (MOQ)')).toBeInTheDocument();
    expect(screen.getByText('ДОСТУПНЫЕ РАЗМЕРЫ')).toBeInTheDocument();
    expect(screen.getByText('ОБРАБОТКИ ПО УМОЛЧАНИЮ')).toBeInTheDocument();
    expect(screen.getByText('ТЕХНИКИ ПО ЗОНАМ')).toBeInTheDocument();
  });

  it('shows tech chips inside expanded category', () => {
    renderTab();
    fireEvent.click(screen.getByText('Футболки'));
    // Tech names appear as chips and in the zone-tech matrix headers
    expect(screen.getAllByText('Шелкография').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Flex').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('DTG').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Вышивка').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('DTF').length).toBeGreaterThanOrEqual(1);
  });

  it('calls onUpdate when toggling a tech', () => {
    const { onUpdate } = renderTab();
    fireEvent.click(screen.getByText('Футболки'));
    // Click the first Шелкография (the chip in ТЕХНИКИ section, not the matrix header)
    const chips = screen.getAllByText('Шелкография');
    fireEvent.click(chips[0]);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0][0];
    const tshirtsRule = updated.find(r => r.categoryId === 'tshirts');
    expect(tshirtsRule.allowedTechs).toBeDefined();
    expect(tshirtsRule.allowedTechs).not.toContain('screen');
  });

  it('calls onUpdate when changing MOQ', () => {
    const { onUpdate } = renderTab();
    fireEvent.click(screen.getByText('Футболки'));
    const moqInput = screen.getByDisplayValue('1');
    fireEvent.change(moqInput, { target: { value: '25' } });
    expect(onUpdate).toHaveBeenCalled();
    const updated = onUpdate.mock.calls[0][0];
    const tshirtsRule = updated.find(r => r.categoryId === 'tshirts');
    expect(tshirtsRule.moq).toBe(25);
  });

  it('shows badges for existing rules', () => {
    const rules = [
      { categoryId: 'hoodies', allowedTechs: ['screen', 'flex'], moq: 10, defaultExtras: ['overlock'] },
    ];
    renderTab(rules);
    expect(screen.getByText('техники: 2/5')).toBeInTheDocument();
    expect(screen.getByText('MOQ: 10')).toBeInTheDocument();
    expect(screen.getByText('обработки: 1')).toBeInTheDocument();
  });

  it('shows zone-tech matrix headers in expanded state', () => {
    renderTab();
    fireEvent.click(screen.getByText('Худи'));
    expect(screen.getByText('Грудь')).toBeInTheDocument();
    expect(screen.getByText('Спина')).toBeInTheDocument();
    expect(screen.getByText('Капюшон')).toBeInTheDocument();
  });

  it('shows extras in expanded state', () => {
    renderTab();
    fireEvent.click(screen.getByText('Футболки'));
    expect(screen.getByText('Обметка')).toBeInTheDocument();
    expect(screen.getByText('Этикетка')).toBeInTheDocument();
  });
});
