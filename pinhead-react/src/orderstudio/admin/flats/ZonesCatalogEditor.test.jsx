import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { putCatalog } from '../../api/catalogAdmin';
import { useStore } from '../../../store/useStore';
import { useAuthStore } from '../../../store/useAuthStore';
import ZonesCatalogEditor from './ZonesCatalogEditor';

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
const SAVE = 'Сохранить зоны';

const DB = [
  { id: 'front', name: 'Грудь', forCategories: null, sortOrder: 1 },
  { id: 'back', name: 'Спина', forCategories: null, sortOrder: 2 },
  { id: 'hood', name: 'Капюшон', forCategories: ['hoodies'], requiresHood: true, sortOrder: 3 },
];

/** matchMedia: телефон (≤ 760 px) или компьютер */
function setPhone(phone) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: phone && q.includes('max-width: 760px'),
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setPhone(false);
  fetchMock.mockResolvedValue({ exists: true, value: DB });
  putMock.mockResolvedValue({ ok: true });
  useStore.setState({ zonesCatalog: DB });
  useAuthStore.setState({ user: { id: 'u-1', role: 'admin', active: true, approved: true } });
});

afterEach(() => {
  delete window.matchMedia;
});

async function open(props = {}) {
  render(<ZonesCatalogEditor readOnly={false} {...props} />);
  await screen.findByRole('textbox', { name: 'Название зоны «Грудь»' });
}

const rowOf = (name) => screen.getByRole('textbox', { name: `Название зоны «${name}»` }).closest('tr');
const lastPut = () => putMock.mock.calls[putMock.mock.calls.length - 1];

describe('ZonesCatalogEditor — справочник зон нанесения', () => {
  it('читает свежим запросом; сохранённое название — только для чтения; кнопка закрыта без правок', async () => {
    await open();
    expect(fetchMock).toHaveBeenCalledWith('app_config', 'zonesCatalog');
    expect(screen.getByRole('textbox', { name: 'Название зоны «Грудь»' })).toHaveAttribute('readonly');
    expect(within(rowOf('Грудь')).getByText('front')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  it('добавить зону: id и название; пишется справочник целиком поверх прочитанной базы', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('id новой зоны'), { target: { value: 'pocket' } });
    fireEvent.change(screen.getByLabelText('Название новой зоны'), { target: { value: 'Карман' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить зону' }));
    // Новая зона, пока не сохранена, — название правится
    expect(screen.getByRole('textbox', { name: 'Название зоны «Карман»' })).not.toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    const [table, key, value, base] = lastPut();
    expect([table, key]).toEqual(['app_config', 'zonesCatalog']);
    expect(base).toEqual(DB);
    expect(value[3]).toEqual({ id: 'pocket', name: 'Карман', forCategories: null, sortOrder: 4 });
    expect(await screen.findByRole('textbox', { name: 'Название зоны «Карман»' })).toHaveAttribute('readonly');
    expect(useStore.getState().zonesCatalog).toEqual(value);
  });

  it('дубль названия (без регистра) — ошибка у формы, зона не добавлена', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('id новой зоны'), { target: { value: 'chest' } });
    fireEvent.change(screen.getByLabelText('Название новой зоны'), { target: { value: ' грудь ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить зону' }));
    expect(screen.getByText('Зона «Грудь» уже есть — название должно отличаться')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Название зоны «грудь»' })).toBeNull();
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  it('строка ТЗ: пустое — «по умолчанию: …»; выбранный код пишется, сброс убирает ключ', async () => {
    await open();
    const select = screen.getByRole('combobox', { name: 'Строка ТЗ: зона «Капюшон»' });
    expect(within(select).getByRole('option', { name: 'по умолчанию: Другое' })).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Строка ТЗ: зона «Грудь»' }))
      .getByRole('option', { name: 'по умолчанию: Полочка' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'hood_l' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(lastPut()[2][2].tz_row).toBe('hood_l');
  });

  it('снять и вернуть: active: false пишется; вернуть — правок нет', async () => {
    await open();
    const box = screen.getByRole('checkbox', { name: 'Предлагать для новых позиций: зона «Спина»' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).not.toBeChecked();
    expect(within(rowOf('Спина')).getByText('снята')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE })).toBeEnabled();
    fireEvent.click(box);
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(lastPut()[2].find((z) => z.id === 'back').active).toBe(false);
  });

  it('порядок: «Поднять» и «Опустить» по имени зоны, sortOrder пересчитан; у краёв кнопки закрыты', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Поднять зону «Грудь»' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Опустить зону «Капюшон»' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Опустить зону «Грудь»' }));
    const names = screen.getAllByRole('textbox', { name: /^Название зоны/ }).map((i) => i.value);
    expect(names).toEqual(['Спина', 'Грудь', 'Капюшон']);
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(lastPut()[2].map((z) => [z.id, z.sortOrder])).toEqual([['back', 1], ['front', 2], ['hood', 3]]);
  });

  it('категории — чипы с «Все»; снять категорию у зоны «для всех»', async () => {
    await open();
    const group = within(screen.getByRole('group', { name: 'Категории зоны «Грудь»' }));
    expect(group.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(group.getByRole('button', { name: 'Футболки' }));
    expect(group.getByRole('button', { name: 'Футболки' })).toHaveAttribute('aria-pressed', 'false');
    expect(group.getByRole('button', { name: 'Все' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(group.getByRole('button', { name: 'Все' }));
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  it('«Только с капюшоном» и «Только с карманом»', async () => {
    await open();
    const pocket = screen.getByRole('checkbox', { name: 'Только с карманом: зона «Грудь»' });
    fireEvent.click(pocket);
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(lastPut()[2][0].requiresPocket).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Только с капюшоном: зона «Капюшон»' })).toBeChecked();
  });

  it('конфликт — плашка вехи 4, правки на экране, сохранение закрыто', async () => {
    putMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'x' });
    await open();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Предлагать для новых позиций: зона «Спина»' }));
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Справочник «Зоны нанесения» уже изменили');
    expect(screen.getByRole('checkbox', { name: 'Предлагать для новых позиций: зона «Спина»' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Загрузить свежую версию' })).toBeInTheDocument();
  });

  it('rop — только просмотр: без кнопки сохранения и добавления, с подписью', async () => {
    useAuthStore.setState({ user: { id: 'u-2', role: 'rop', active: true, approved: true } });
    await open();
    expect(screen.getByText('Зоны меняет администратор или директор')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить зону' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Предлагать для новых позиций: зона «Спина»' })).toBeDisabled();
  });

  it('пустой справочник — «Зон нанесения пока нет — добавьте первую»', async () => {
    fetchMock.mockResolvedValue({ exists: true, value: [] });
    render(<ZonesCatalogEditor readOnly={false} />);
    expect(await screen.findByText('Зон нанесения пока нет — добавьте первую')).toBeInTheDocument();
  });
});

describe('ZonesCatalogEditor — телефон (≤ 760 px)', () => {
  it('карточки, а не таблица: название, строка ТЗ, «снята»; без id, порядка, добавления и сохранения', async () => {
    setPhone(true);
    fetchMock.mockResolvedValue({ exists: true, value: [...DB.slice(0, 2), { ...DB[2], active: false }] });
    const { container } = render(<ZonesCatalogEditor readOnly />);
    const card = (await screen.findByRole('heading', { name: 'Капюшон' })).closest('li');
    expect(screen.queryByRole('table')).toBeNull();
    expect(card).toHaveTextContent('Строка ТЗ: Другое');
    expect(card).toHaveTextContent('снята');
    expect(container).not.toHaveTextContent('hood');
    expect(screen.queryByRole('button', { name: /Поднять|Опустить/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить зону' })).toBeNull();
    expect(screen.queryByRole('button', { name: SAVE })).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  });
});
