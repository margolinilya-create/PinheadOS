import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SkuEditor from './SkuEditor';
import { useStore } from '../../store/useStore';
import { useToastStore } from '../../store/useToastStore';
import { supabase } from '../../lib/supabase';
import { fetchCatalogKey } from '../../lib/catalogs';
import { putCatalog, patchPrices } from '../../orderstudio/api/catalogAdmin';

vi.mock('../../lib/catalogs', () => ({
  fetchCatalogKey: vi.fn(),
  clearCatalogsCache: vi.fn(),
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../orderstudio/api/catalogAdmin', () => ({
  PRICE_RULE_KEYS: ['packOptions', 'prepFees', 'minMarginPct'],
  putCatalog: vi.fn(),
  patchPrices: vi.fn(),
}));

const putMock = vi.mocked(putCatalog);
const patchMock = vi.mocked(patchPrices);
const fetchMock = vi.mocked(fetchCatalogKey);
/** Настоящий `setField` стора: общий `beforeEach` подменяет его заглушкой */
const realSetField = useStore.getState().setField;

function renderSkuEditor() {
  return render(
    <MemoryRouter>
      <SkuEditor />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    skuCatalog: [
      { code: 'tee-001', name: 'T-Shirt Basic', category: 'tshirts', fit: 'regular', sewingPrice: 200, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, zones: ['front', 'back'] },
    ],
    fabricsCatalog: [
      { code: 'cotton-30', name: 'Cotton 30/1', priceUSD: 3.5, forCategories: ['tshirts'] },
    ],
    trimCatalog: [
      { code: 'ribana-1x1', name: 'Рибана 1x1', priceUSD: 2.5 },
    ],
    usdRate: 90,
    setField: vi.fn(),
  });
});

describe('SkuEditor', () => {
  it('renders actions bar', () => {
    renderSkuEditor();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
    expect(screen.getByText('Excel ↓')).toBeInTheDocument();
  });

  it('renders tabs', () => {
    renderSkuEditor();
    expect(screen.getByText('Изделия')).toBeInTheDocument();
    expect(screen.getByText('Основная ткань')).toBeInTheDocument();
    expect(screen.getByText('Отделочная ткань')).toBeInTheDocument();
    expect(screen.getByText('Обработки')).toBeInTheDocument();
    expect(screen.getByText('Фурнитура')).toBeInTheDocument();
  });

  it('shows items tab by default', () => {
    renderSkuEditor();
    expect(screen.getByDisplayValue('T-Shirt Basic')).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderSkuEditor();
    expect(screen.getByPlaceholderText('Поиск...')).toBeInTheDocument();
  });

  it('shows add button', () => {
    renderSkuEditor();
    expect(screen.getByText('+ Добавить')).toBeInTheDocument();
  });

  it('shows save button', () => {
    renderSkuEditor();
    expect(screen.getByText('Сохранить')).toBeInTheDocument();
  });

  it('switches to fabrics tab', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByText('Основная ткань'));
    expect(screen.getByText('Cotton 30/1')).toBeInTheDocument();
  });

  it('switches to trims tab', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByText('Отделочная ткань'));
    expect(screen.getByText('Рибана 1x1')).toBeInTheDocument();
  });

  it('shows exchange rate bar', () => {
    renderSkuEditor();
    expect(screen.getByText('КУРС ЦБ:')).toBeInTheDocument();
    expect(screen.getByText('ВНУТРЕННИЙ:')).toBeInTheDocument();
  });

  it('shows add modal when clicking add', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByText('+ Добавить'));
    expect(screen.getByText('Добавить изделие')).toBeInTheDocument();
  });

  it('shows SKU count', () => {
    renderSkuEditor();
    expect(screen.getByText(/Всего: 1 SKU/)).toBeInTheDocument();
  });
});

const SKU = [
  { code: 'tee-001', name: 'T-Shirt Basic', category: 'tshirts', fit: 'regular', sewingPrice: 200, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, zones: ['front', 'back'] },
];
const TRIMS = [{ code: 'ribana-1x1', name: 'Рибана 1x1', priceRub: 100, unit: 'm' }];

const tabDirty = (name) => Boolean(screen.getByRole('button', { name }).querySelector('.pe-tab-dot'));
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

describe('SkuEditor — запись без затирания (веха 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useStore.setState({ skuCatalog: SKU, trimCatalog: TRIMS, usdRate: 90, setField: realSetField, catalogSource: 'db' });
    putMock.mockResolvedValue({ ok: true });
    patchMock.mockResolvedValue({ ok: true });
  });

  it('пишет только изменённый справочник через catalog_put с базой от открытия', async () => {
    renderSkuEditor();
    fireEvent.change(screen.getByDisplayValue('T-Shirt Basic'), { target: { value: 'Футболка' } });
    save();
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock).toHaveBeenCalledWith('app_config', 'sku_catalog', [{ ...SKU[0], name: 'Футболка' }], SKU);
    expect(patchMock).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    await waitFor(() => expect(toasts()).toContain('Каталог сохранён'));
    expect(tabDirty('Изделия')).toBe(false);
  });

  it('без правок ничего не пишет — ни прайс целиком, ни умолчания кода', async () => {
    renderSkuEditor();
    save();
    await waitFor(() => expect(toasts().length).toBeGreaterThan(0));
    expect(putMock).not.toHaveBeenCalled();
    expect(patchMock).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('курс — одним ключом прайса (prices_patch), не прайсом целиком', async () => {
    renderSkuEditor();
    fireEvent.change(screen.getByDisplayValue('90'), { target: { value: '95' } });
    save();
    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(1));
    expect(patchMock).toHaveBeenCalledWith({ usdRate: 95 }, { usdRate: 90 });
    expect(putMock).not.toHaveBeenCalled();
  });

  it('частичный отказ: флаги отказавшего справочника не сброшены, «Сохранено локально» не пишется', async () => {
    putMock.mockImplementation(async (_t, key) => (key === 'sku_catalog'
      ? { ok: false, kind: 'conflict', message: 'Справочник изменён — загрузите свежую версию' }
      : { ok: true }));
    renderSkuEditor();
    fireEvent.change(screen.getByDisplayValue('T-Shirt Basic'), { target: { value: 'Футболка' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отделочная ткань' }));
    fireEvent.change(screen.getByDisplayValue('100'), { target: { value: '120' } });
    expect(tabDirty('Изделия')).toBe(true);
    expect(tabDirty('Отделочная ткань')).toBe(true);
    save();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/Изделия/)).toBeInTheDocument();
    expect(within(alert).queryByText(/Отделочная ткань/)).not.toBeInTheDocument();
    expect(tabDirty('Изделия')).toBe(true);
    expect(tabDirty('Отделочная ткань')).toBe(false);
    expect(toasts().join(' ')).not.toMatch(/локально/);
    expect(toasts()).not.toContain('Каталог сохранён');
    // Правки на экране остались
    expect(useStore.getState().skuCatalog[0].name).toBe('Футболка');
  });

  it('после конфликта: повтор сохранения идёт с прежней базой; «Загрузить свежую версию» берёт базу из базы данных', async () => {
    putMock.mockResolvedValueOnce({ ok: false, kind: 'conflict', message: 'x' });
    const FRESH = [{ ...SKU[0], name: 'Изменили в ERP' }];
    fetchMock.mockResolvedValue({ exists: true, value: FRESH });
    renderSkuEditor();
    fireEvent.change(screen.getByDisplayValue('T-Shirt Basic'), { target: { value: 'Футболка' } });
    save();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить свежую версию' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'sku_catalog');
    expect(useStore.getState().skuCatalog).toEqual(FRESH);
    expect(tabDirty('Изделия')).toBe(false);
    // Новая правка — поверх свежей версии, база — она же
    fireEvent.change(screen.getByDisplayValue('Изменили в ERP'), { target: { value: 'Футболка' } });
    save();
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(2));
    expect(putMock).toHaveBeenLastCalledWith('app_config', 'sku_catalog', [{ ...SKU[0], name: 'Футболка' }], FRESH);
  });

  it('каталог пришёл из базы уже после открытия редактора — база следует за ним, пока правок нет', async () => {
    useStore.setState({ skuCatalog: [] });
    renderSkuEditor();
    // loadCatalogs завершился позже открытия
    useStore.setState({ skuCatalog: SKU });
    fireEvent.change(await screen.findByDisplayValue('T-Shirt Basic'), { target: { value: 'Футболка' } });
    save();
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock.mock.calls[0][3]).toEqual(SKU);
  });

  it('каталог не из базы (ещё не загрузился или запасной путь) — «Сохранить» закрыт, ничего не пишется', async () => {
    useStore.setState({ catalogSource: 'fallback' });
    renderSkuEditor();
    expect(screen.getByText(/Каталог не загрузился из базы/)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('T-Shirt Basic'), { target: { value: 'Футболка' } });
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
    save();
    expect(putMock).not.toHaveBeenCalled();
    // Каталог дозагрузился из базы — сохранение открылось
    act(() => useStore.setState({ catalogSource: 'db' }));
    expect(screen.getByRole('button', { name: 'Сохранить' })).not.toBeDisabled();
    expect(screen.queryByText(/Каталог не загрузился из базы/)).not.toBeInTheDocument();
  });
});
