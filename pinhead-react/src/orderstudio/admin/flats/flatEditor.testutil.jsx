/**
 * Заготовки тестов редактора флэта (веха 5б, задача 6б). Холст мокается
 * по контракту задачи 6а в самих тестах (`vi.mock('./canvas/FlatCanvas')`);
 * здесь — обвязка с адресом (`flat`, `view`) и данные.
 */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../../store/useAuthStore';
import { useStore } from '../../../store/useStore';
import FlatEditorHarness from './FlatEditorHarness.testutil';

export const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><g id="garment"><path d="M0 0h600v700H0z" fill="#cccccc"/></g></svg>';
export const ZONES = [
  { id: 'front', name: 'Грудь (перед)' },
  { id: 'back', name: 'Спина' },
  { id: 'sleeve-l', name: 'Левый рукав' },
  { id: 'sleeve-r', name: 'Правый рукав' },
  { id: 'old', name: 'Старая', active: false },
];
export const SKUS = [
  { code: 'T-001', name: 'Футболка классика', category: 'tshirts' },
  { code: 'H-001', name: 'Худи базовое', category: 'hoodies' },
];

/** Последний адрес обвязки (`?tab=flats&flat=…&view=…`) */
export const where = { search: '' };
const track = (search) => { where.search = search; };

export function renderEditor({ flatId = 'tshirt-test', view, role = 'admin', readOnly = false, onBack = () => {}, onMakeExact = () => {}, copyFrom = null } = {}) {
  useAuthStore.setState({ user: { id: 'u-1', role, active: true, approved: true } });
  useStore.setState({ skuCatalog: SKUS });
  const q = `?tab=flats&flat=${flatId}${view ? `&view=${view}` : ''}`;
  return render(
    <MemoryRouter initialEntries={[`/order-settings${q}`]}>
      <FlatEditorHarness readOnly={readOnly} onBack={onBack} onMakeExact={onMakeExact} copyFrom={copyFrom} onLocation={track} />
    </MemoryRouter>,
  );
}
