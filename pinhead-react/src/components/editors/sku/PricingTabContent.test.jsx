import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PricingTabContent from './PricingTabContent';
import { useStore } from '../../../store/useStore';
import { useToastStore } from '../../../store/useToastStore';
import { supabase } from '../../../lib/supabase';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { patchPrices } from '../../../orderstudio/api/catalogAdmin';
import { PRICES, FLEX_MATRIX } from '../../../data/prices';

vi.mock('../../../lib/catalogs', () => ({
  fetchCatalogKey: vi.fn(),
  clearCatalogsCache: vi.fn(),
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../store/useConfirmStore', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('../../../orderstudio/api/catalogAdmin', () => ({
  PRICE_RULE_KEYS: ['packOptions', 'prepFees', 'minMarginPct'],
  putCatalog: vi.fn(),
  patchPrices: vi.fn(),
}));

const fetchMock = vi.mocked(fetchCatalogKey);
const patchMock = vi.mocked(patchPrices);

/** Прайс в базе — без многих ключей кода (умолчания мержатся только на экране) */
const DB = { screenColoredMult: 1.3, usdRate: 90, packOptions: [{ key: 'zip', name: 'ЗИП', price: 40 }] };

const colored = () => screen.getByLabelText('Цветной текстиль');
const saveBtn = () => screen.getByRole('button', { name: 'Сохранить цены' });
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useToastStore.setState({ toasts: [] });
  useStore.setState({ prices: PRICES });
  fetchMock.mockResolvedValue({ exists: true, value: DB });
  patchMock.mockResolvedValue({ ok: true });
});

async function ready() {
  render(<PricingTabContent />);
  await waitFor(() => expect(saveBtn()).not.toBeDisabled());
}

describe('PricingTabContent — прайс без затирания (веха 4)', () => {
  it('читает прайс свежим запросом и пишет только изменённый ключ с прежним значением', async () => {
    await ready();
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'prices');
    fireEvent.change(colored(), { target: { value: '1.4' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith({ screenColoredMult: 1.4 }, { screenColoredMult: 1.3 });
    expect(supabase.from).not.toHaveBeenCalled();
    await waitFor(() => expect(toasts()).toContain('Цены сохранены'));
    // Стор — прайс базы с правкой поверх умолчаний кода
    expect(useStore.getState().prices.screenColoredMult).toBe(1.4);
    expect(useStore.getState().prices.packOptions).toEqual(DB.packOptions);
  });

  it('без правок ничего не пишет — умолчания кода в базу не уходят', async () => {
    await ready();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('конфликт: правка остаётся, «Сохранено локально» нет, свежая версия — кнопкой', async () => {
    patchMock.mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'Справочник изменён — загрузите свежую версию' });
    await ready();
    fireEvent.change(colored(), { target: { value: '1.4' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent(/уже изменили/);
    expect(colored()).toHaveValue(1.4);
    expect(screen.getByText('1 изм.')).toBeInTheDocument();
    expect(toasts().join(' ')).not.toMatch(/локально/);
    expect(saveBtn()).toBeDisabled();

    fetchMock.mockResolvedValue({ exists: true, value: { ...DB, screenColoredMult: 1.6 } });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить свежую версию' }));
    await waitFor(() => expect(colored()).toHaveValue(1.6));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('прайс не загрузился — сохранение закрыто', async () => {
    fetchMock.mockResolvedValue(null);
    render(<PricingTabContent />);
    expect(await screen.findByText(/Прайс не загрузился/)).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('флекс: правка ячейки уходит в prices_patch матрицей целиком, база — матрица из базы', async () => {
    // После миграции G ключ flexMatrix засеян (= FLEX_MATRIX кода)
    fetchMock.mockResolvedValue({ exists: true, value: { ...DB, flexMatrix: FLEX_MATRIX } });
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Флекс' }));
    fireEvent.change(screen.getByLabelText('Флекс A4, 1 цв., тираж 1+'), { target: { value: '760' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const [patch, base] = patchMock.mock.calls[0];
    expect(Object.keys(patch)).toEqual(['flexMatrix']);
    expect(patch.flexMatrix.A4[1]).toEqual([760, ...FLEX_MATRIX.A4[1].slice(1)]);
    // Остальные форматы и цвета — на месте, а не разреженная матрица из одной ячейки
    expect({ ...patch.flexMatrix, A4: FLEX_MATRIX.A4 }).toEqual(FLEX_MATRIX);
    expect(patch.flexMatrix.A4[2]).toEqual(FLEX_MATRIX.A4[2]);
    expect(base).toEqual({ flexMatrix: FLEX_MATRIX });
    await waitFor(() => expect(toasts()).toContain('Цены сохранены'));
  });

  it('флекса в прайсе нет — правка начинается с умолчаний кода, матрица полная', async () => {
    await ready();
    fireEvent.click(screen.getByRole('tab', { name: 'Флекс' }));
    fireEvent.change(screen.getByLabelText('Флекс A6, 2 цв., тираж 20+'), { target: { value: '210' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const [patch] = patchMock.mock.calls[0];
    expect(Object.keys(patch.flexMatrix).sort()).toEqual(Object.keys(FLEX_MATRIX).sort());
    expect(patch.flexMatrix.A6[2]).toEqual([450, 210, 177, 148]);
    expect(patch.flexMatrix.A3).toEqual(FLEX_MATRIX.A3);
  });

  it('«Сброс» возвращает умолчания только на экране; правила цены «Справочников заказа» не трогает', async () => {
    fetchMock.mockResolvedValue({ exists: true, value: { ...DB, screenColoredMult: 1.7 } });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить к умолчаниям' }));
    await waitFor(() => expect(colored()).toHaveValue(PRICES.screenColoredMult));
    expect(patchMock).not.toHaveBeenCalled();
    fireEvent.click(saveBtn());
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    const [patch, base] = patchMock.mock.calls[0];
    expect(patch).toEqual({ screenColoredMult: PRICES.screenColoredMult, usdRate: PRICES.usdRate });
    expect(base).toEqual({ screenColoredMult: 1.7, usdRate: 90 });
  });
});
