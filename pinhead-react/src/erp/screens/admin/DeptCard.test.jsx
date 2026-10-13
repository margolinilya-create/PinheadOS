import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeptCard } from './DeptCard';

/**
 * Карточка участка (компактная раскладка) получает обработчики СТАБИЛЬНЫМИ
 * и без привязки к участку — привязывает их сама. Так экран перестал создавать
 * набор стрелок на строку, и `memo` карточки работает. Здесь проверяется, что
 * после переделки каждое действие по-прежнему уходит со СВОИМ участком.
 */
const DEPT = {
  id: 'd1', code: 'cut', name: 'Закрой', active: true, sort_order: 10, norm_days: 2,
  is_production: true, is_branding: false, allows_over_plan: false,
  gate_material_kinds: [], result_fields: [], head_employee_id: null,
};

function renderCard() {
  const h = {
    onUpdate: vi.fn(),
    onToggleProduction: vi.fn(),
    onToggleGateKind: vi.fn(),
    onToggleActive: vi.fn(),
  };
  render(<DeptCard dept={DEPT} headCandidates={[]} {...h} />);
  return h;
}

describe('карточка участка', () => {
  it('«Отключить участок» отдаёт сам участок', () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole('button', { name: /Отключить участок/ }));
    expect(h.onToggleActive).toHaveBeenCalledWith(DEPT);
  });

  it('признак «производственный» — участок и новое значение', () => {
    const h = renderCard();
    fireEvent.click(screen.getByLabelText(/Участок Закрой — производственный/));
    expect(h.onToggleProduction).toHaveBeenCalledWith(DEPT, false);
  });

  it('брендирование и «плюсы» — патчем по id участка', () => {
    const h = renderCard();
    fireEvent.click(screen.getByLabelText(/Участок Закрой — этап брендирования/));
    expect(h.onUpdate).toHaveBeenCalledWith('d1', { is_branding: true });
    fireEvent.click(screen.getByLabelText(/можно сдать больше тиража/));
    expect(h.onUpdate).toHaveBeenCalledWith('d1', { allows_over_plan: true });
  });
});
