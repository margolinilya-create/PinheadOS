import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useStore } from '../../../store/useStore';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../../data/fabricsCatalog';
import { SUPPLIERS_SEED } from '../../../orderstudio/catalog/seeds';
import { updateColor } from '../../../orderstudio/catalog/suppliers';
import ColorPicker, { OWN_COLOR_HINT } from './ColorPicker';

const SKU = SKU_CATALOG_DEFAULT.find((s) => s.category === 'tshirts');
const MEDAS = 'medas-kulirnaya-100-180';
const COTTON = 'cotton-kulirnaya-100-180';

/** Тонитекс: своя привязка, палитры нет */
const TONITEX = {
  id: 'tonitex', name: 'Тонитекс', isDefault: false, fabricSupplierNames: ['ТониТекс'], active: true,
  palette: { groups: [], colors: [] },
};

function setup(state = {}) {
  useStore.getState().resetItemFields();
  useStore.setState({
    sku: SKU, type: SKU.category, fabric: MEDAS, color: '', colorSupplier: 'medastex',
    fabricsCatalog: FABRICS_CATALOG_DEFAULT, suppliers: SUPPLIERS_SEED, categoryRules: [],
    ...state,
  });
  return render(<ColorPicker />);
}

const swatch = (label) => screen.getByRole('button', { name: label });

beforeEach(() => useStore.getState().resetItemFields());

describe('ColorPicker — палитра поставщика ткани', () => {
  it('ткань Медас — только палитра Медастекс, кнопки с названием и кодом', () => {
    setup();
    expect(swatch('Белый (01-01)')).toHaveAttribute('aria-pressed', 'false');
    expect(swatch('Белый (01-01)').tagName).toBe('BUTTON');
    expect(screen.queryByRole('button', { name: 'Белый (5001)' })).toBeNull();
    // Переключателя палитр больше нет — палитру задаёт ткань
    expect(screen.queryByRole('button', { name: /CottonProm/ })).toBeNull();
  });

  it('непривязанный поставщик — палитра по умолчанию', () => {
    setup({ fabric: COTTON, colorSupplier: '' });
    expect(swatch('Белый (5001)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Белый (01-01)' })).toBeNull();
  });

  it('выбор цвета пишет код в буфер', () => {
    setup();
    fireEvent.click(swatch('Молочный (01-02)'));
    expect(useStore.getState().color).toBe('01-02');
    expect(swatch('Молочный (01-02)')).toHaveAttribute('aria-pressed', 'true');
  });

  it('только чтение: клик не меняет цвет', () => {
    useStore.getState().resetItemFields();
    useStore.setState({ sku: SKU, type: SKU.category, fabric: MEDAS, suppliers: SUPPLIERS_SEED, fabricsCatalog: FABRICS_CATALOG_DEFAULT });
    render(<ColorPicker readOnly />);
    fireEvent.click(swatch('Молочный (01-02)'));
    expect(useStore.getState().color).toBe('');
    expect(swatch('Молочный (01-02)')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('Свой цвет')).toBeDisabled();
  });

  it('поиск по названию и коду', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Поиск цвета'), { target: { value: '01-02' } });
    expect(swatch('Молочный (01-02)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Белый (01-01)' })).toBeNull();
  });
});

describe('ColorPicker — снятые и чужие цвета', () => {
  it('снятый цвет не предлагается', () => {
    setup({ suppliers: updateColor(SUPPLIERS_SEED, 'medastex', '01-02', { active: false }) });
    expect(screen.queryByRole('button', { name: 'Молочный (01-02)' })).toBeNull();
  });

  it('выбранный снятый — показан с пометкой и не стирается', () => {
    setup({ color: '01-02', suppliers: updateColor(SUPPLIERS_SEED, 'medastex', '01-02', { active: false }) });
    const current = screen.getByTestId('color-current');
    expect(current).toHaveTextContent('Молочный (01-02)');
    expect(current).toHaveTextContent('снят с продажи');
    expect(useStore.getState().color).toBe('01-02');
  });

  it('«Белый (5001)» у ткани Медас — из другой палитры, с пометкой', () => {
    setup({ color: '5001' });
    const current = screen.getByTestId('color-current');
    expect(current).toHaveTextContent('Белый (5001)');
    expect(current).toHaveTextContent('из палитры «Коттонпром»');
  });

  it('hex со вставкой разметки — в стиль идёт #ccc', () => {
    const bad = updateColor(SUPPLIERS_SEED, 'medastex', '01-01', { hex: '#fff" onload=alert(1)' });
    setup({ suppliers: bad });
    const circle = swatch('Белый (01-01)').querySelector('[data-swatch-circle]');
    expect(circle.style.getPropertyValue('--swatch-color')).toBe('#ccc');
  });
});

describe('ColorPicker — выбранный образец', () => {
  it('галочка одна и только у выбранного, выбор передан не только цветом', () => {
    setup({ color: '01-01' });
    const white = swatch('Белый (01-01)');
    expect(white).toHaveAttribute('aria-pressed', 'true');
    expect(white.querySelectorAll('svg')).toHaveLength(1);
    expect(swatch('Молочный (01-02)').querySelectorAll('svg')).toHaveLength(0);
  });

  it('инлайн-стиль образца — только вычисляемый цвет', () => {
    setup({ color: '01-01' });
    const styled = [...document.querySelectorAll('[style]')];
    expect(styled.length).toBeGreaterThan(0);
    for (const el of styled) {
      expect([...el.style].every((p) => p === '--swatch-color'), el.getAttribute('style')).toBe(true);
    }
  });
});

describe('ColorPicker — ограничение цветов модели (allowedColors, К10)', () => {
  const rules = (allowedColors) => [{ categoryId: SKU.category, allowedColors }];

  it('коды из палитры ткани — только они и подсказка «N из M»', () => {
    setup({ categoryRules: rules(['01-01', '01-02']) });
    const grid = screen.getByRole('group', { name: 'Палитра Медастекс' });
    expect(within(grid).getAllByRole('button')).toHaveLength(2);
    const total = useStore.getState().suppliers.find((s) => s.id === 'medastex').palette.colors.length;
    expect(screen.getByText(`Для этой модели доступно 2 из ${total} цветов «Медастекс»`)).toBeInTheDocument();
  });

  it('коды Медастекс у ткани другого поставщика — палитра целиком, не пусто', () => {
    setup({ fabric: COTTON, colorSupplier: '', categoryRules: rules(['01-01', '01-02']) });
    const grid = screen.getByRole('group', { name: 'Палитра Коттонпром' });
    expect(within(grid).getAllByRole('button').length).toBeGreaterThan(2);
    expect(screen.queryByText(/Для этой модели доступно/)).toBeNull();
  });
});

describe('ColorPicker — свой цвет текстом', () => {
  it('у поставщика нет палитры — подсказка и поле', () => {
    setup({ fabric: 'tonitex-kulirnaya-100-180', fabricsCatalog: [...FABRICS_CATALOG_DEFAULT, { code: 'tonitex-kulirnaya-100-180', name: 'Кулирка', supplier: 'ТониТекс', forCategories: ['tshirts'] }], suppliers: [...SUPPLIERS_SEED, TONITEX] });
    expect(screen.getByText(OWN_COLOR_HINT)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0);
  });

  it('вписанный цвет уходит в буфер по Enter и по уходу с поля', () => {
    setup();
    const input = screen.getByLabelText('Свой цвет');
    fireEvent.change(input, { target: { value: '  розовый  ' } });
    expect(useStore.getState().color).toBe('');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useStore.getState().color).toBe('розовый');
    fireEvent.change(input, { target: { value: 'малиновый' } });
    fireEvent.blur(input);
    expect(useStore.getState().color).toBe('малиновый');
  });

  it('свой цвет из позиции виден в поле, ни одна кнопка не нажата', () => {
    setup({ color: 'розовый' });
    expect(screen.getByLabelText('Свой цвет')).toHaveValue('розовый');
    const grid = screen.getByRole('group', { name: 'Палитра Медастекс' });
    expect(within(grid).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });
});
