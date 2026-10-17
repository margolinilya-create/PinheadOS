import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useStore } from '../../../store/useStore';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../../data/fabricsCatalog';
import { SUPPLIERS_SEED } from '../../../orderstudio/catalog/seeds';
import { updateColor } from '../../../orderstudio/catalog/suppliers';
import FabricGrid from './FabricGrid';

const SKU = SKU_CATALOG_DEFAULT.find((s) => s.category === 'tshirts');
const MEDAS = FABRICS_CATALOG_DEFAULT.find((f) => f.code === 'medas-kulirnaya-100-180');
const TONITEX = FABRICS_CATALOG_DEFAULT.find((f) => f.supplier === 'ТониТекс' && (f.forCategories || []).includes('tshirts'));

function setup(state = {}) {
  useStore.getState().resetItemFields();
  useStore.setState({
    sku: { ...SKU, allowedFabrics: [] }, type: SKU.category, fabric: '', color: '', colorSupplier: '',
    fabricsCatalog: FABRICS_CATALOG_DEFAULT, suppliers: SUPPLIERS_SEED, categoryRules: [],
    ...state,
  });
  render(<FabricGrid />);
}

/** Карточка ткани по поставщику и плотности (подпись: «… · <поставщик>») */
const fabricCard = (f) => screen.getAllByRole('button')
  .find((b) => b.textContent.includes(f.supplier) && b.textContent.includes(`${f.density} г/м²`) && b.textContent.includes(f.name));

beforeEach(() => useStore.getState().resetItemFields());

describe('FabricGrid — выбор ткани ставит палитру из справочника', () => {
  it('ткань Медас → палитра Медастекс', () => {
    setup();
    fireEvent.click(fabricCard(MEDAS));
    expect(useStore.getState().fabric).toBe(MEDAS.code);
    expect(useStore.getState().colorSupplier).toBe('medastex');
  });

  it('непривязанный поставщик → палитра по умолчанию', () => {
    setup({ colorSupplier: 'medastex' });
    fireEvent.click(fabricCard(TONITEX));
    expect(useStore.getState().colorSupplier).toBe('cottonprom');
  });

  it('новая привязка из справочника работает без правки кода', () => {
    const suppliers = [...SUPPLIERS_SEED, {
      id: 'tonitex', name: 'Тонитекс', isDefault: false, fabricSupplierNames: ['ТониТекс'], active: true,
      palette: { groups: [], colors: [] },
    }];
    setup({ suppliers });
    fireEvent.click(fabricCard(TONITEX));
    expect(useStore.getState().colorSupplier).toBe('tonitex');
  });

  it('только чтение — ткань не меняется', () => {
    useStore.getState().resetItemFields();
    useStore.setState({ sku: SKU, type: SKU.category, fabricsCatalog: FABRICS_CATALOG_DEFAULT, suppliers: SUPPLIERS_SEED });
    render(<FabricGrid readOnly />);
    fireEvent.click(fabricCard(MEDAS));
    expect(useStore.getState().fabric).toBe('');
  });
});

describe('FabricGrid — число доступных цветов', () => {
  it('считаются только активные цвета палитры ткани', () => {
    const total = SUPPLIERS_SEED[0].palette.colors.length;
    setup({ fabric: MEDAS.code, suppliers: updateColor(SUPPLIERS_SEED, 'medastex', '01-01', { active: false }) });
    expect(screen.getByText(`Доступные цвета: ${total - 1}`)).toBeInTheDocument();
  });
});
