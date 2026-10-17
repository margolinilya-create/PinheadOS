import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog } from '../../api/catalogAdmin';
import { useStore } from '../../../store/useStore';
import { LABEL_LIBRARY_SEED } from '../../catalog/seeds';
import { setCatalogUnsaved } from '../../leaveGuard';
import LabelsTab from './LabelsTab';

vi.mock('../../../lib/catalogs', () => ({
  fetchCatalogKey: vi.fn(),
  clearCatalogsCache: vi.fn(),
  loadAllCatalogs: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/catalogAdmin', () => ({
  putCatalog: vi.fn(),
  patchPrices: vi.fn(),
}));

const fetchMock = vi.mocked(fetchCatalogKey);
const putMock = vi.mocked(putCatalog);
const DB = LABEL_LIBRARY_SEED;
const SAVE = 'Сохранить бирки и схемы';

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ exists: true, value: DB });
  putMock.mockResolvedValue({ ok: true });
  useStore.setState({ labelLibrary: LABEL_LIBRARY_SEED });
});

async function open(readOnly = false) {
  render(<LabelsTab readOnly={readOnly} />);
  await screen.findByRole('heading', { name: 'Брендовая бирка' });
  return screen.getByRole('button', { name: SAVE });
}

const brandSection = () => screen.getByRole('region', { name: 'Брендовая бирка' });

describe('LabelsTab — редактор библиотеки', () => {
  it('читает свежим запросом; виды, варианты, материалы и схемы на экране', async () => {
    const save = await open();
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'labelLibrary');
    const brand = within(brandSection());
    expect(brand.getByRole('textbox', { name: 'Название: Брендовая бирка, вариант 2' })).toHaveValue('Своя (дизайн клиента)');
    expect(brand.getByRole('textbox', { name: 'Цена, ₽/шт: Брендовая бирка, вариант 2' })).toHaveValue('45');
    expect(brand.getByRole('textbox', { name: 'Надбавка, ₽/шт: Брендовая бирка, материал 2' })).toHaveValue('-5');
    const schemes = within(screen.getByRole('region', { name: 'Схемы притачивания' }));
    expect(schemes.getByRole('textbox', { name: 'Название: схема 1' })).toHaveValue('На воротнике (спина)');
    expect(save).toBeDisabled();
  });

  it('новая цена варианта пишется справочником целиком поверх прочитанной базы', async () => {
    const save = await open();
    fireEvent.change(within(brandSection()).getByRole('textbox', { name: 'Цена, ₽/шт: Брендовая бирка, вариант 2' }), { target: { value: '70' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [table, key, value, base] = putMock.mock.calls[0];
    expect([table, key]).toEqual(['app_config', 'labelLibrary']);
    expect(base).toEqual(DB);
    const brand = value.kinds.find((k) => k.type === 'brand');
    expect(brand.variants.find((v) => v.id === 'custom').price).toBe(70);
    // Заказы сразу считают по записанному
    await waitFor(() => expect(useStore.getState().labelLibrary).toEqual(value));
  });

  it('снять вариант с продажи — флажок, не удаление', async () => {
    const save = await open();
    fireEvent.click(within(brandSection()).getByRole('checkbox', { name: 'В продаже: Брендовая бирка, вариант 3' }));
    fireEvent.click(save);
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const brand = putMock.mock.calls[0][2].kinds.find((k) => k.type === 'brand');
    expect(brand.variants.map((v) => v.id)).toEqual(['standard', 'custom', 'send-own']);
    expect(brand.variants.find((v) => v.id === 'send-own').active).toBe(false);
  });

  it('новый вариант, материал и схема получают новые id; без названия сохранить нельзя', async () => {
    const save = await open();
    fireEvent.click(within(brandSection()).getByRole('button', { name: '+ Вариант: Брендовая бирка' }));
    fireEvent.click(within(brandSection()).getByRole('button', { name: '+ Материал: Брендовая бирка' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Схема притачивания' }));
    expect(save).toBeDisabled();
    expect(screen.getByText('Брендовая бирка: у варианта 4 нет названия')).toBeInTheDocument();
    fireEvent.change(within(brandSection()).getByRole('textbox', { name: 'Название: Брендовая бирка, вариант 4' }), { target: { value: 'Сатин' } });
    fireEvent.change(within(brandSection()).getByRole('textbox', { name: 'Название: Брендовая бирка, материал 4' }), { target: { value: 'Атлас' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Название: схема 3' }), { target: { value: 'Под ярлык' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    const value = putMock.mock.calls[0][2];
    const brand = value.kinds.find((k) => k.type === 'brand');
    expect(brand.variants.at(-1)).toEqual({ id: 'v-4', name: 'Сатин', price: 0, withMaterial: false, active: true });
    expect(brand.materials.at(-1)).toEqual({ key: 'm-4', name: 'Атлас', priceDelta: 0, active: true });
    expect(value.schemes.at(-1)).toEqual({ id: 's-3', name: 'Под ярлык', active: true });
  });

  it('конфликт: правки на экране, сохранение закрыто до свежей версии', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'x' });
    const save = await open();
    const price = () => within(brandSection()).getByRole('textbox', { name: 'Цена, ₽/шт: Брендовая бирка, вариант 2' });
    fireEvent.change(price(), { target: { value: '70' } });
    fireEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('Справочник «Бирки и схемы» уже изменили');
    expect(price()).toHaveValue('70');
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить свежую версию' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    setCatalogUnsaved('labels-test', false);
  });

  it('не загрузилось — встроенные значения видны, сохранить нельзя', async () => {
    fetchMock.mockResolvedValue(null);
    render(<LabelsTab readOnly={false} />);
    expect(await screen.findByText(/Справочник не загрузился/)).toBeInTheDocument();
    fireEvent.change(within(brandSection()).getByRole('textbox', { name: 'Цена, ₽/шт: Брендовая бирка, вариант 2' }), { target: { value: '70' } });
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  it('телефон: только просмотр, кнопки сохранения нет', async () => {
    render(<LabelsTab readOnly />);
    await screen.findByRole('heading', { name: 'Брендовая бирка' });
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(within(brandSection()).getByRole('textbox', { name: 'Название: Брендовая бирка, вариант 1' })).toBeDisabled();
  });
});
