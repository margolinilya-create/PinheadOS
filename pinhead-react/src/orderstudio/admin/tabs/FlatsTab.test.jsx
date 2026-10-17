import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { useAuthStore } from '../../../store/useAuthStore';
import { useToastStore } from '../../../store/useToastStore';
import { seedFlats } from '../../design/seed/seedFlats';
import { validFlatsCatalog } from '../../design/catalog/flatsCases';
import { catalogConflictText } from '../useCatalogEditor';
import { flatRow, seedStatusText, zonesCount } from './flatsView';
import FlatsTab from './FlatsTab';

vi.mock('../../../lib/catalogs', async (orig) => ({ ...(await orig()), fetchCatalogKey: vi.fn() }));
vi.mock('../../design/seed/seedFlats', () => ({ seedFlats: vi.fn() }));

const fetchMock = vi.mocked(fetchCatalogKey);
const seedMock = vi.mocked(seedFlats);
const BUTTON = 'Загрузить типовые флэты';

function renderTab(role = 'admin', props = {}) {
  useAuthStore.setState({ user: { id: 'u-1', role, active: true, approved: true } });
  return render(<FlatsTab readOnly={false} {...props} />);
}

const toasts = (type) => useToastStore.getState().toasts.filter((t) => t.type === type).map((t) => t.message);

beforeEach(() => {
  fetchMock.mockReset();
  seedMock.mockReset();
  useToastStore.setState({ toasts: [] });
  fetchMock.mockResolvedValue({ exists: false, value: null });
});

describe('FlatsTab — список', () => {
  it('флэтов нет: пустое состояние с числом моделей сида и кнопкой', async () => {
    renderTab('admin');
    expect(await screen.findByText('Типовых силуэтов пока нет. Загрузите 35 моделей одной кнопкой')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'garmentFlats');
  });

  it('флэты есть: название, тип, «типовой», виды и зоны', async () => {
    fetchMock.mockResolvedValue({ exists: true, value: validFlatsCatalog() });
    renderTab('admin');
    const row = (await screen.findByText('Футболка Regular')).closest('tr');
    expect(row).toHaveTextContent('tshirt-regular');
    expect(row).toHaveTextContent('Футболка');
    expect(row).toHaveTextContent('Типовой');
    expect(row).toHaveTextContent('Перед, Спина');
    expect(row).toHaveTextContent('3 зоны');
    expect(row).toHaveTextContent('Грудь, Этикетка');
  });

  it('битые записи не роняют экран: замечания под списком', async () => {
    const value = validFlatsCatalog();
    value.flats.push({ id: 'Плохой', name: 'x' });
    fetchMock.mockResolvedValue({ exists: true, value });
    renderTab('admin');
    expect(await screen.findByText('Футболка Regular')).toBeInTheDocument();
    expect(screen.getByText(/1 запись справочника с ошибками не показана/)).toBeInTheDocument();
  });

  it('справочник не прочитан: плашка и повтор, загрузка сида закрыта', async () => {
    fetchMock.mockResolvedValueOnce(null);
    renderTab('admin');
    expect(await screen.findByText('Справочник флэтов не загрузился.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: BUTTON })).toBeDisabled();
    fetchMock.mockResolvedValueOnce({ exists: false, value: null });
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить снова' }));
    expect(await screen.findByText(/Типовых силуэтов пока нет/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('FlatsTab — права', () => {
  it('rop: только просмотр и подпись, кнопки нет', async () => {
    renderTab('rop');
    expect(await screen.findByText('Флэты меняет администратор или директор')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
    expect(screen.getByText('Типовых силуэтов пока нет. Их загружает администратор или директор')).toBeInTheDocument();
  });

  it('director — кнопка есть', async () => {
    renderTab('director');
    expect(await screen.findByRole('button', { name: BUTTON })).toBeInTheDocument();
  });

  it('телефон (только просмотр): у admin кнопки нет', async () => {
    renderTab('admin', { readOnly: true });
    await screen.findByText(/Типовых силуэтов пока нет/);
    expect(screen.queryByRole('button', { name: BUTTON })).toBeNull();
  });
});

describe('FlatsTab — загрузка типовых флэтов', () => {
  it('сид грузится только по кнопке; прогресс в aria-live; успех — тост и свежий список', async () => {
    let finish;
    seedMock.mockImplementation(({ onProgress }) => new Promise((resolve) => {
      onProgress({ done: 3, total: 67, phase: 'files' });
      finish = resolve;
    }));
    renderTab('admin');
    const button = await screen.findByRole('button', { name: BUTTON });
    expect(seedMock).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(seedMock).toHaveBeenCalledTimes(1));
    const status = await screen.findByText('Загружаю файлы флэтов: 3 из 67');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: BUTTON })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '3');

    fetchMock.mockResolvedValue({ exists: true, value: validFlatsCatalog() });
    await act(async () => finish({ uploaded: 67, existed: 0, failed: 0, added: 35, catalog: 'saved' }));
    expect(await screen.findByText('Футболка Regular')).toBeInTheDocument();
    expect(toasts('success')).toContain('Типовые флэты загружены: 35 моделей');
    expect(screen.getByRole('button', { name: BUTTON })).not.toHaveAttribute('aria-busy', 'true');
  });

  it('все уже в справочнике — тост, справочник не перечитывается', async () => {
    seedMock.mockResolvedValue({ uploaded: 0, existed: 0, failed: 0, added: 0, catalog: 'unchanged' });
    renderTab('admin');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toasts('success')).toContain('Все типовые флэты уже в справочнике'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('конфликт записи — плашка вкладок вехи 4 и «Загрузить свежую версию»', async () => {
    seedMock.mockResolvedValue({ uploaded: 67, existed: 0, failed: 0, added: 0, catalog: 'conflict' });
    renderTab('admin');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(catalogConflictText('Флэты и зоны'));
    expect(screen.getByRole('button', { name: BUTTON })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Загрузить свежую версию' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('чанк сида не загрузился (вышло обновление) — тост с советом обновить страницу', async () => {
    seedMock.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module: /assets/seedFlats-x.js'));
    renderTab('admin');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    await waitFor(() => expect(toasts('error').at(-1)).toMatch(/^Вышло обновление приложения\. /));
    expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled();
  });

  it('частичный сбой — справочник прежний, кнопку можно нажать снова', async () => {
    seedMock.mockResolvedValue({ uploaded: 10, existed: 0, failed: 57, added: 0, catalog: 'error' });
    renderTab('admin');
    fireEvent.click(await screen.findByRole('button', { name: BUTTON }));
    await waitFor(() => expect(seedMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toasts('success')).toEqual([]);
  });
});

describe('flatsView — показ', () => {
  it('строка флэта: виды, зоны без повторов, точные модели', () => {
    const f = { ...validFlatsCatalog().flats[0], typical: false, sku_codes: ['T-006'] };
    expect(flatRow(f)).toMatchObject({
      type: 'Футболка', kind: 'Лекало модели', models: 'T-006', views: 'Перед, Спина', zones: ['Грудь', 'Этикетка'],
    });
    expect(zonesCount(1)).toBe('1 зона');
    expect(zonesCount(5)).toBe('5 зон');
  });

  it('строка состояния сида', () => {
    expect(seedStatusText(null, false)).toBe('');
    expect(seedStatusText(null, true)).toMatch(/Готовлю/);
    expect(seedStatusText({ done: 2, total: 67, phase: 'files' }, true)).toBe('Загружаю файлы флэтов: 2 из 67');
    expect(seedStatusText({ done: 67, total: 67, phase: 'catalog' }, true)).toMatch(/сохраняю справочник/);
  });
});
