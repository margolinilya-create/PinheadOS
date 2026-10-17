import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog } from '../../api/catalogAdmin';
import { useStore } from '../../../store/useStore';
import { FABRICS_CATALOG_DEFAULT } from '../../../data/fabricsCatalog';
import { SUPPLIERS_SEED } from '../../catalog/seeds';
import { setCatalogUnsaved } from '../../leaveGuard';
import { catalogConflictText } from '../useCatalogEditor';
import SuppliersTab from './SuppliersTab';

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

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ exists: true, value: SUPPLIERS_SEED });
  putMock.mockResolvedValue({ ok: true });
  useStore.setState({ fabricsCatalog: FABRICS_CATALOG_DEFAULT, suppliers: SUPPLIERS_SEED });
});
afterEach(() => setCatalogUnsaved('test', false));

async function open(props = {}) {
  render(<SuppliersTab {...props} />);
  await screen.findByLabelText('Название поставщика');
}

/*
 * Запросы — по тексту и подписи: роль с именем на сотне строк палитры
 * считается секундами и упирается в таймаут при полном прогоне.
 */
const saveBtn = () => screen.getByText('Сохранить поставщиков');
const supplierBtn = (name) => screen.getByText(new RegExp(`^${name}`), { selector: 'button' });
const pickSupplier = (name) => fireEvent.click(supplierBtn(name));
const box = (name) => screen.getByLabelText(name, { exact: false, selector: 'input[type="checkbox"]' });
const savedValue = () => putMock.mock.calls[0][2];
/** Строка цвета по коду в ячейке (поиск по роли с именем на сотне строк медленный) */
const colorRow = (code) => screen.getByText(code, { selector: 'td' }).closest('tr');
const noRow = (code) => expect(screen.queryByText(code, { selector: 'td' })).toBeNull();

async function addColor({ code, name, hex }) {
  fireEvent.click(screen.getByText('Добавить цвет'));
  fireEvent.change(screen.getByLabelText('Код цвета'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('Название цвета'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Hex цвета'), { target: { value: hex } });
}

describe('SuppliersTab — загрузка и сохранение', () => {
  it('свежий справочник; без правок сохранять нечего', async () => {
    await open();
    expect(fetchMock).toHaveBeenCalledWith('catalog_config', 'suppliers');
    expect(saveBtn()).toBeDisabled();
    expect(supplierBtn('Коттонпром')).toHaveTextContent('по умолчанию');
  });

  it('добавить цвет → сохранение пишет справочник с базой из загрузки', async () => {
    await open();
    await addColor({ code: 'M-1', name: 'Мятный', hex: '#AAFFCC' });
    fireEvent.click(screen.getByText('Готово'));
    expect(colorRow('M-1')).toHaveTextContent('Мятный');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [table, key, value, base] = putMock.mock.calls[0];
    expect(table).toBe('catalog_config');
    expect(key).toBe('suppliers');
    expect(base).toEqual(SUPPLIERS_SEED);
    expect(value[0].palette.colors.at(-1)).toEqual({ code: 'M-1', name: 'Мятный', hex: '#AAFFCC', group: '', active: true });
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('снять с продажи — строка уходит из списка, «Показать снятые» возвращает; в записи active: false', async () => {
    await open();
    fireEvent.click(within(colorRow('01-02')).getByRole('button', { name: 'Снять с продажи' }));
    noRow('01-02');
    fireEvent.click(screen.getByLabelText('Показать снятые'));
    expect(colorRow('01-02')).toHaveTextContent('снят с продажи');
    fireEvent.click(within(colorRow('01-02')).getByRole('button', { name: 'Вернуть' }));
    fireEvent.click(within(colorRow('01-02')).getByRole('button', { name: 'Снять с продажи' }));
    fireEvent.click(saveBtn());
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(savedValue()[0].palette.colors.find((c) => c.code === '01-02').active).toBe(false);
  });

  it('привязать имя ткани к палитре; непривязанные — предупреждение', async () => {
    await open();
    const note = () => screen.getByText(/^Без привязки/);
    expect(note()).toHaveAttribute('role', 'note');
    expect(note()).toHaveTextContent('ТониТекс');
    fireEvent.click(box('ТониТекс'));
    expect(note()).not.toHaveTextContent('ТониТекс');
    fireEvent.click(saveBtn());
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(savedValue()[0].fabricSupplierNames).toEqual(['Медас', 'ТониТекс']);
  });

  it('привязка переносится из другой палитры — имя не двоится', async () => {
    await open();
    pickSupplier('Коттонпром');
    const medas = box('Медас');
    expect(medas.closest('label')).toHaveTextContent('сейчас — Медастекс');
    fireEvent.click(medas);
    fireEvent.click(saveBtn());
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(savedValue()[0].fabricSupplierNames).toEqual([]);
    expect(savedValue()[1].fabricSupplierNames).toEqual(['Медас']);
  });

  it('палитра по умолчанию — ровно одна', async () => {
    await open();
    fireEvent.click(screen.getByLabelText('Палитра по умолчанию'));
    expect(supplierBtn('Медастекс')).toHaveTextContent('по умолчанию');
    expect(supplierBtn('Коттонпром')).not.toHaveTextContent('по умолчанию');
  });

  it('новый поставщик — пустая палитра', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Новый поставщик'), { target: { value: 'Тонитекс' } });
    fireEvent.click(screen.getByText('Добавить поставщика'));
    expect(supplierBtn('Тонитекс')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/В палитре нет цветов/)).toBeInTheDocument();
  });
});

describe('SuppliersTab — проверка перед сохранением', () => {
  it('дубль кода по всем палитрам: ошибка у поля, сохранение закрыто', async () => {
    await open();
    await addColor({ code: '5001', name: 'Дубль', hex: '#000000' });
    const code = screen.getByLabelText('Код цвета');
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(code.getAttribute('aria-describedby'))).toHaveTextContent('Код уже есть в палитре «Коттонпром»');
    expect(saveBtn()).toBeDisabled();
  });

  it('hex: aria-invalid и aria-describedby, образец — #ccc', async () => {
    await open();
    await addColor({ code: 'M-9', name: 'Плохой', hex: '#fff" onload=alert(1)' });
    const hex = screen.getByLabelText('Hex цвета');
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(hex.getAttribute('aria-describedby'))).toHaveTextContent('#RRGGBB');
    const sample = screen.getByTestId('hex-sample');
    expect(sample.style.backgroundColor).toBe('rgb(204, 204, 204)');
    expect(saveBtn()).toBeDisabled();
  });

  it('код сохранённого цвета не меняется — он уже может стоять в заказах', async () => {
    await open();
    fireEvent.click(within(colorRow('01-01')).getByRole('button', { name: /Изменить/ }));
    expect(screen.getByLabelText('Код цвета')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Название цвета'), { target: { value: 'Снежный' } });
    fireEvent.click(screen.getByText('Готово'));
    expect(colorRow('01-01')).toHaveTextContent('Снежный');
  });

  it('поиск по коду и названию', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Поиск цвета в палитре'), { target: { value: 'Молочный' } });
    expect(colorRow('01-02')).toBeInTheDocument();
    noRow('01-01');
  });
});

describe('SuppliersTab — конфликт и запасной путь', () => {
  it('конфликт: текст, правки на месте, «Загрузить свежую версию» перечитывает', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'x' });
    await open();
    await addColor({ code: 'M-1', name: 'Мятный', hex: '#AAFFCC' });
    fireEvent.click(screen.getByText('Готово'));
    fireEvent.click(saveBtn());
    const alert = await screen.findByText(catalogConflictText('Поставщики и палитры'));
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    expect(colorRow('M-1')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(screen.getByText('Загрузить свежую версию'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('справочник не загрузился — показ встроенных значений, сохранение закрыто', async () => {
    fetchMock.mockResolvedValue(null);
    await open();
    expect(colorRow('01-02')).toBeInTheDocument();
    expect(screen.queryByText('Снять с продажи')).toBeNull();
    expect(saveBtn()).toBeDisabled();
    expect(screen.getByText('Загрузить снова')).toBeInTheDocument();
  });

  it('только чтение (телефон): правка закрыта, кнопки сохранения нет', async () => {
    await open({ readOnly: true });
    expect(screen.queryByText('Сохранить поставщиков')).toBeNull();
    expect(screen.queryByText('Добавить цвет')).toBeNull();
    expect(screen.queryByText('Снять с продажи')).toBeNull();
    expect(box('ТониТекс')).toBeDisabled();
  });
});
