import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SkuDetailModal from './SkuDetailModal';
import { useStore } from '../../../store/useStore';
import { SUPPLIERS_SEED } from '../../../orderstudio/catalog/seeds';
import { offeredColors } from '../../../orderstudio/catalog/suppliers';

const medas = offeredColors(SUPPLIERS_SEED.find((s) => s.id === 'medastex'));
const cotton = offeredColors(SUPPLIERS_SEED.find((s) => s.id === 'cottonprom'));

const SKU = {
  code: 'tee-001', name: 'Футболка', category: 'tshirts', fit: 'regular', sewingPrice: 200,
  mainFabricUsage: 1, trimCode: null, trimUsage: 0, zones: ['front'], mockupType: 'tee',
};

function renderModal(sku = SKU) {
  const onUpdate = vi.fn();
  const onClose = vi.fn();
  render(<SkuDetailModal sku={sku} skuIndex={0} onUpdate={onUpdate} onClose={onClose} onPersist={vi.fn()} />);
  return { onUpdate, onClose };
}

beforeEach(() => {
  useStore.setState({
    suppliers: SUPPLIERS_SEED,
    fabricsCatalog: [
      { code: 'medas-kulir', name: 'Кулирка', supplier: 'Медас', forCategories: ['tshirts'], priceRub: 300, unit: 'm' },
      { code: 'td-kulir', name: 'Кулирка ТД', supplier: 'ТД Коттон', forCategories: ['tshirts'], priceRub: 280, unit: 'm' },
    ],
    trimCatalog: [], extrasCatalog: [], categoryRules: [], usdRate: 90,
  });
});

describe('SkuDetailModal — карточка модели на примитиве Modal', () => {
  it('диалог с именем модели; «Закрыть» закрывает', () => {
    const { onClose } = renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Модель: Футболка' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('поля подписаны, инлайн-стили — только цвет образца', () => {
    renderModal();
    expect(screen.getByLabelText('Название')).toHaveValue('Футболка');
    expect(screen.getByLabelText('Пошив, ₽')).toHaveValue(200);
    fireEvent.click(screen.getByRole('button', { name: /все цвета/ }));
    const styled = [...document.querySelectorAll('[style]')];
    expect(styled.length).toBeGreaterThan(0);
    for (const el of styled) expect(el.getAttribute('style')).toMatch(/^--swatch-color:/);
  });

  it('цвета — палитры поставщиков тканей модели (Медастекс и Коттонпром), не только Медастекс', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /все цвета/ }));
    expect(screen.getByRole('group', { name: 'Палитра «Медастекс»' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Палитра «Коттонпром»' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `все цвета (${medas.length + cotton.length})` })).toBeInTheDocument();
  });

  it('первый щелчок по образцу — ограничение «все коды палитр модели, кроме этого», форма прежняя (string[])', () => {
    const { onUpdate } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /все цвета/ }));
    const c = cotton[0];
    fireEvent.click(screen.getByRole('button', { name: `${c.name} (${c.code})` }));
    const [, field, value] = onUpdate.mock.calls.at(-1);
    expect(field).toBe('overrides');
    expect(Array.isArray(value.allowedColors)).toBe(true);
    expect(value.allowedColors).not.toContain(c.code);
    expect(value.allowedColors).toContain(medas[0].code);
    expect(value.allowedColors).toHaveLength(medas.length + cotton.length - 1);
  });

  it('выбор образца передан не только цветом — aria-pressed', () => {
    renderModal({ ...SKU, overrides: { allowedColors: [medas[0].code] } });
    fireEvent.click(screen.getByRole('button', { name: /из/ }));
    expect(screen.getByRole('button', { name: `${medas[0].name} (${medas[0].code})` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: `${medas[1].name} (${medas[1].code})` })).toHaveAttribute('aria-pressed', 'false');
  });

  it('фото нет — силуэт картинкой, без HTML строкой', () => {
    renderModal();
    const add = screen.getByRole('button', { name: /Добавить фото/ });
    expect(add.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
});
