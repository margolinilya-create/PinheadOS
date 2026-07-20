import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ZonesCatalogTab from './ZonesCatalogTab';

const defaultZones = [
  { id: 'front', name: 'Грудь', forCategories: null, sortOrder: 1 },
  { id: 'back', name: 'Спина', forCategories: null, sortOrder: 2 },
  { id: 'hood', name: 'Капюшон', forCategories: ['hoodies'], sortOrder: 3 },
];

const mockSku = [
  { code: 'T-001', name: 'Футболка', zones: ['front', 'back'] },
  { code: 'H-001', name: 'Худи', zones: ['front', 'back', 'hood'] },
];

function renderTab(zones = defaultZones, onUpdate = vi.fn()) {
  return {
    onUpdate,
    ...render(
      <ZonesCatalogTab
        zonesCatalog={zones}
        skuCatalog={mockSku}
        onUpdate={onUpdate}
      />
    ),
  };
}

describe('ZonesCatalogTab', () => {
  it('renders all zones in the table', () => {
    renderTab();
    expect(screen.getByDisplayValue('Грудь')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Спина')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Капюшон')).toBeInTheDocument();
  });

  it('shows zone IDs', () => {
    renderTab();
    expect(screen.getByText('front')).toBeInTheDocument();
    expect(screen.getByText('back')).toBeInTheDocument();
    expect(screen.getByText('hood')).toBeInTheDocument();
  });

  it('shows hint text', () => {
    renderTab();
    expect(screen.getByText(/Глобальный каталог зон/)).toBeInTheDocument();
  });

  it('calls onUpdate when renaming a zone', () => {
    const { onUpdate } = renderTab();
    const input = screen.getByDisplayValue('Грудь');
    fireEvent.change(input, { target: { value: 'Грудь (перед)' } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0][0];
    expect(updated[0].name).toBe('Грудь (перед)');
    expect(updated[1].name).toBe('Спина'); // unchanged
  });

  it('calls onUpdate when adding a new zone', () => {
    const { onUpdate } = renderTab();
    const idInput = screen.getByPlaceholderText('ID (латиница)');
    const nameInput = screen.getByPlaceholderText('Название');
    fireEvent.change(idInput, { target: { value: 'leg' } });
    fireEvent.change(nameInput, { target: { value: 'Нога' } });
    fireEvent.click(screen.getByText('+ Добавить'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0][0];
    expect(updated.length).toBe(4);
    expect(updated[3].id).toBe('leg');
    expect(updated[3].name).toBe('Нога');
  });

  it('does not add zone with empty ID', () => {
    const { onUpdate } = renderTab();
    fireEvent.click(screen.getByText('+ Добавить'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does not add zone with duplicate ID', () => {
    const { onUpdate } = renderTab();
    const idInput = screen.getByPlaceholderText('ID (латиница)');
    fireEvent.change(idInput, { target: { value: 'front' } });
    fireEvent.click(screen.getByText('+ Добавить'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('calls onUpdate when deleting a zone not used by SKUs', () => {
    // hood is used by H-001, but we'll test deleting with confirm
    const zonesWithUnused = [...defaultZones, { id: 'unused', name: 'Неиспользуемая', forCategories: null, sortOrder: 4 }];
    const { onUpdate } = renderTab(zonesWithUnused);
    const deleteButtons = screen.getAllByLabelText('Удалить зону');
    // Delete the last zone (unused)
    fireEvent.click(deleteButtons[3]);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const updated = onUpdate.mock.calls[0][0];
    expect(updated.length).toBe(3);
    expect(updated.find(z => z.id === 'unused')).toBeUndefined();
  });

  it('shows "все" chip for zones with forCategories: null', () => {
    renderTab();
    const allChips = screen.getAllByText('все');
    expect(allChips.length).toBe(2); // front and back have null forCategories
  });
});
