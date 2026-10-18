import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

function mockCompact(matches) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });

describe('SkuEditor', () => {
  afterEach(() => { delete window.matchMedia; });

  it('шапка — h1 «Каталог моделей и цен», кнопки называют действие, без глифов', () => {
    renderSkuEditor();
    expect(screen.getByRole('heading', { level: 1, name: 'Каталог моделей и цен' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выгрузить в Excel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить из Excel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить каталог' })).toBeInTheDocument();
    expect(screen.queryByText(/[↓↑↻]/)).not.toBeInTheDocument();
  });

  it('вкладки — tablist/tab, панель связана с вкладкой', () => {
    renderSkuEditor();
    const list = screen.getByRole('tablist', { name: 'Разделы каталога' });
    const names = within(list).getAllByRole('tab').map((t) => t.textContent);
    expect(names).toEqual(['Изделия', 'Основная ткань', 'Отделочная ткань', 'Обработки',
      'Фурнитура', 'Ценообразование', 'Правила категорий', 'Зоны нанесения']);
    expect(tab('Изделия')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab('Изделия').id);
  });

  it('вкладка — в адресе: ?tab=fabrics открывает ткани', () => {
    render(
      <MemoryRouter initialEntries={['/sku?tab=fabrics']}>
        <SkuEditor />
      </MemoryRouter>
    );
    expect(tab('Основная ткань')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Cotton 30/1')).toBeInTheDocument();
  });

  it('shows items tab by default', () => {
    renderSkuEditor();
    expect(screen.getByDisplayValue('T-Shirt Basic')).toBeInTheDocument();
  });

  it('поиск модели — поле с подписью', () => {
    renderSkuEditor();
    expect(screen.getByRole('searchbox', { name: 'Поиск модели' })).toBeInTheDocument();
  });

  it('switches to fabrics tab', () => {
    renderSkuEditor();
    fireEvent.click(tab('Основная ткань'));
    expect(screen.getByText('Cotton 30/1')).toBeInTheDocument();
  });

  it('switches to trims tab', () => {
    renderSkuEditor();
    fireEvent.click(tab('Отделочная ткань'));
    expect(screen.getByText('Рибана 1x1')).toBeInTheDocument();
  });

  it('курс: поле «Внутренний курс, ₽/$» с подписью, обновление ЦБ — кнопка с именем, без капса', () => {
    localStorage.setItem('ph_cb_rate', JSON.stringify({ rate: 92.4, date: '17.10' }));
    renderSkuEditor();
    expect(screen.getByLabelText('Внутренний курс, ₽/$')).toHaveValue(90);
    expect(screen.getByText('Курс ЦБ: 92,4 ₽/$ (17.10)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Обновить курс ЦБ' })).toBeInTheDocument();
    expect(screen.queryByText('КУРС ЦБ:')).not.toBeInTheDocument();
    expect(screen.queryByText('ВНУТРЕННИЙ:')).not.toBeInTheDocument();
  });

  it('добавление модели — диалог с заголовком', () => {
    renderSkuEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить модель' }));
    expect(screen.getByRole('dialog', { name: 'Добавить модель' })).toBeInTheDocument();
  });

  it('shows SKU count', () => {
    renderSkuEditor();
    expect(screen.getByText('Моделей: 1')).toBeInTheDocument();
  });

  it('≤ 760 px — только просмотр: пояснение, «Выгрузить» есть, загрузки и сохранения нет, поля закрыты', () => {
    mockCompact(true);
    renderSkuEditor();
    expect(screen.getByRole('note')).toHaveTextContent(/^На телефоне каталог только для просмотра\. Править — с компьютера\.$/);
    expect(screen.getByRole('button', { name: 'Выгрузить в Excel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить из Excel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить каталог' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Добавить модель' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('T-Shirt Basic')).toBeDisabled();
    expect(screen.getByLabelText('Внутренний курс, ₽/$')).toBeDisabled();
    // Навигация работает: вкладки переключаются
    fireEvent.click(tab('Основная ткань'));
    expect(screen.getByText('Cotton 30/1')).toBeInTheDocument();
  });

  it('на компьютере пояснения «только просмотр» нет', () => {
    mockCompact(false);
    renderSkuEditor();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('инлайн-стилей и глобальных классов редактора в разметке нет', () => {
    const { container } = renderSkuEditor();
    expect(container.querySelector('[style]')).toBeNull();
    expect(container.querySelector('[class*="sku-ed-"], [class*="pe-tab"], .page-search')).toBeNull();
  });
});

const SKU = [
  { code: 'tee-001', name: 'T-Shirt Basic', category: 'tshirts', fit: 'regular', sewingPrice: 200, mainFabricUsage: 1.0, trimCode: 'ribana-1x1', trimUsage: 0.15, zones: ['front', 'back'] },
];
const TRIMS = [{ code: 'ribana-1x1', name: 'Рибана 1x1', priceRub: 100, unit: 'm' }];

/** Признак несохранённых правок — в доступном имени вкладки */
const tabDirty = (name) => /есть несохранённые правки/.test(tab(name).textContent);
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить каталог' }));

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
    fireEvent.change(screen.getByLabelText('Внутренний курс, ₽/$'), { target: { value: '95' } });
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
    fireEvent.click(tab('Отделочная ткань'));
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
    expect(screen.getByRole('button', { name: 'Сохранить каталог' })).toBeDisabled();
    save();
    expect(putMock).not.toHaveBeenCalled();
    // Каталог дозагрузился из базы — сохранение открылось
    act(() => useStore.setState({ catalogSource: 'db' }));
    expect(screen.getByRole('button', { name: 'Сохранить каталог' })).not.toBeDisabled();
    expect(screen.queryByText(/Каталог не загрузился из базы/)).not.toBeInTheDocument();
  });
});
