import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { useToastStore } from '../../../store/useToastStore';
import { downloadFlatSvg } from '../../api/garmentFlats';
import { flat } from '../../design/fixtures.testutil';
import { catalogHasUnsaved } from '../../leaveGuard';
import { saveFlat } from './saveFlat';
import { renderEditor, SVG, ZONES, where } from './flatEditor.testutil';

vi.mock('../../../lib/catalogs', async (orig) => ({ ...(await orig()), fetchCatalogKey: vi.fn() }));
vi.mock('./saveFlat', async (orig) => ({ ...(await orig()), saveFlat: vi.fn() }));
vi.mock('../../api/garmentFlats', async (orig) => ({ ...(await orig()), downloadFlatSvg: vi.fn() }));
/** Холст — по контракту задачи 6а; интеграцию с настоящим проверяет e2e (задача 7) */
vi.mock('./canvas/FlatCanvas', () => ({
  default: (p) => <button type="button" aria-label={p.label} data-readonly={String(p.readOnly)} />,
}));

const fetchMock = vi.mocked(fetchCatalogKey);
const saveMock = vi.mocked(saveFlat);
let flatsRow;

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  flatsRow = { exists: true, value: { version: 1, flats: [flat()] } };
  fetchMock.mockImplementation(async (_t, key) => (key === 'zonesCatalog' ? { exists: true, value: ZONES } : flatsRow));
  vi.mocked(downloadFlatSvg).mockResolvedValue(SVG);
});

const saveButton = () => screen.getByRole('button', { name: /^(Сохранить флэт|Выпустить версию \d+|Создать флэт)$/ });
const opened = async () => screen.findByRole('button', { name: 'Холст флэта: Футболка (тест), вид Перед' });
const toasts = (type) => useToastStore.getState().toasts.filter((t) => t.type === type).map((t) => t.message);
const okResult = (f, released = null) => ({ ok: true, flat: f, raw: { version: 1, flats: [f] }, released });

function typeInto(label, value) {
  const input = screen.getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe('FlatEditor — шапка и кнопка (К6)', () => {
  it('открытие: имя, «Версия 1», холст вида «Перед»; без правок кнопка закрыта и называет результат', async () => {
    renderEditor();
    await opened();
    expect(screen.getByRole('heading', { name: 'Футболка (тест)' })).toBeInTheDocument();
    expect(screen.getByText('Версия 1')).toBeInTheDocument();
    expect(saveButton()).toHaveTextContent('Сохранить флэт');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Перед' })).toHaveAttribute('aria-selected', 'true');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('правка рамки зоны → «Выпустить версию 2» с подсказкой; несохранённое — в leaveGuard', async () => {
    renderEditor();
    await opened();
    typeInto('X, мм', '160');
    expect(saveButton()).toHaveTextContent('Выпустить версию 2');
    expect(saveButton()).toBeEnabled();
    expect(screen.getByText('Нанесения в заказах останутся на версии 1, пока менеджер не перенесёт их')).toBeInTheDocument();
    expect(screen.getByText('Есть несохранённые правки')).toBeInTheDocument();
    expect(catalogHasUnsaved()).toBe(true);
  });

  it('правка строки ТЗ — метаданные: «Сохранить флэт»', async () => {
    renderEditor();
    await opened();
    fireEvent.change(screen.getByLabelText('Строка ТЗ'), { target: { value: 'front_l' } });
    expect(saveButton()).toHaveTextContent('Сохранить флэт');
    expect(saveButton()).toBeEnabled();
  });

  it('«Отменить правки силуэта» → снова «Сохранить флэт», метаданные на месте', async () => {
    renderEditor();
    await opened();
    fireEvent.click(screen.getByRole('tab', { name: 'Модель и подбор' }));
    fireEvent.change(screen.getByLabelText('Название флэта'), { target: { value: 'Футболка новая' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Зоны' }));
    typeInto('Y, мм', '150');
    expect(saveButton()).toHaveTextContent('Выпустить версию 2');
    fireEvent.click(screen.getByRole('button', { name: 'Отменить правки силуэта' }));
    expect(saveButton()).toHaveTextContent('Сохранить флэт');
    expect(screen.getByRole('heading', { name: 'Футболка новая' })).toBeInTheDocument();
  });

  it('сохранение метаданных: saveFlat с черновиком, тост «Флэт сохранён»', async () => {
    renderEditor();
    await opened();
    fireEvent.change(screen.getByLabelText('Строка ТЗ'), { target: { value: 'front_l' } });
    const saved = flat();
    saved.views[0].print_areas[0].tz_row = 'front_l';
    saveMock.mockResolvedValue(okResult(saved));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toasts('success')).toContain('Флэт сохранён'));
    expect(saveMock.mock.calls[0][0].draft.views[0].print_areas[0].tz_row).toBe('front_l');
    expect(saveMock.mock.calls[0][0].files).toEqual({});
  });
});

describe('FlatEditor — проверка и «Перейти»', () => {
  it('код модели у двух активных флэтов → ошибка, кнопка закрыта и объясняет почему', async () => {
    flatsRow = { exists: true, value: { version: 1, flats: [flat(), flat({ id: 'other', name: 'Другой', sku_codes: ['T-001'] })] } };
    renderEditor();
    await opened();
    fireEvent.click(screen.getByRole('tab', { name: 'Модель и подбор' }));
    fireEvent.change(screen.getByLabelText('Модели'), { target: { value: 'T-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'T-001 — Футболка классика' }));
    expect(screen.getByRole('heading', { name: 'Нужно исправить (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Перейти: Модель T-001 уже у флэта «Другой»/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Модели')).toHaveAccessibleDescription(/Модель T-001 уже у флэта «Другой»/);
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('aria-describedby', expect.stringContaining('flat-save-why'));
    expect(screen.getByText('Исправьте 1 ошибку — список выше')).toBeInTheDocument();
  });

  it('«Перейти» выбирает вид и зону и ставит фокус в поле; у поля aria-invalid', async () => {
    renderEditor();
    await opened();
    fireEvent.click(screen.getByRole('tab', { name: 'Спина' }));
    fireEvent.change(screen.getByLabelText('Зона из справочника'), { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Перед' }));
    expect(screen.getByRole('tab', { name: 'Перед' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Перейти: Зона «Старая» снята с подбора/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Зона из справочника')));
    expect(screen.getByRole('tab', { name: 'Спина' })).toHaveAttribute('aria-selected', 'true');
    expect(where.search).toContain('view=back');
    expect(document.activeElement).toHaveAttribute('aria-invalid', 'true');
    expect(document.activeElement).toHaveAccessibleDescription(/снята с подбора/);
  });
});

describe('FlatEditor — состояния', () => {
  it('конфликт → плашка с текстом флэта и фокус на ней; «Загрузить свежую версию» перечитывает', async () => {
    renderEditor();
    await opened();
    fireEvent.change(screen.getByLabelText('Строка ТЗ'), { target: { value: 'front_l' } });
    saveMock.mockResolvedValue({ ok: false, kind: 'conflict', message: 'x' });
    fireEvent.click(saveButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Флэт «Футболка (тест)» уже изменил другой администратор');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect(saveButton()).toBeDisabled();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Загрузить свежую версию' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('rop: без кнопки сохранения и правки, поля закрыты, холст только для чтения', async () => {
    renderEditor({ role: 'rop', readOnly: true });
    const canvas = await opened();
    expect(canvas).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByText('Флэты меняет администратор или директор')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Сохранить флэт|Выпустить/ })).toBeNull();
    expect(screen.getByLabelText('Название')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Добавить зону' })).toBeDisabled();
    // Вкладки видов и панели читаются
    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    expect(screen.getByText('Прежних версий нет')).toBeInTheDocument();
  });

  it('missing — текст и «К списку флэтов»', async () => {
    const onBack = vi.fn();
    renderEditor({ flatId: 'no-such', onBack });
    expect(await screen.findByText(/Флэта «no-such» нет в справочнике/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'К списку флэтов' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('broken → «Открыть для исправления» → после правки «Сохранить флэт» доступна', async () => {
    flatsRow = { exists: true, value: { version: 1, flats: [flat({ id: 'broken-one', garment_type: 'kimono' })] } };
    renderEditor({ flatId: 'broken-one' });
    expect(await screen.findByText(/Запись флэта «broken-one» повреждена/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть для исправления' }));
    expect(await screen.findByRole('heading', { name: /Нужно исправить/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Модель и подбор' }));
    fireEvent.change(screen.getByLabelText('Тип изделия'), { target: { value: 'tshirt' } });
    expect(screen.queryByRole('heading', { name: /Нужно исправить/ })).toBeNull();
    expect(saveButton()).toHaveTextContent('Сохранить флэт');
    expect(saveButton()).toBeEnabled();
  });

  it('справочник не загрузился — «Загрузить снова»', async () => {
    fetchMock.mockImplementation(async () => null);
    renderEditor();
    expect(await screen.findByText('Не удалось загрузить справочник флэтов.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить снова' })).toBeInTheDocument();
  });
});

describe('FlatEditor — новый флэт', () => {
  const file = (text, name = 'polo.svg') => new File([text], name, { type: 'image/svg+xml' });

  async function pick(input, f) {
    await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });
  }

  it('id предложен из имени, тип — из модели; «Создать флэт» вызывает сохранение с файлом', async () => {
    flatsRow = { exists: false, value: null };
    renderEditor({ flatId: 'new' });
    const input = await screen.findByLabelText('SVG первого вида');
    await pick(input, file(SVG));
    fireEvent.change(screen.getByLabelText('Название флэта'), { target: { value: 'Худи классика' } });
    expect(screen.getByLabelText(/^id флэта/)).toHaveValue('khudi-klassika');
    fireEvent.change(screen.getByLabelText(/^Модели/), { target: { value: 'H-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'H-001 — Худи базовое' }));
    expect(screen.getByLabelText('Тип изделия')).toHaveValue('hoodie');
    fireEvent.click(screen.getByRole('button', { name: 'Подготовить флэт' }));
    expect(await screen.findByRole('button', { name: 'Создать флэт' })).toBeEnabled();
    const created = { ...flat({ id: 'khudi-klassika', name: 'Худи классика' }) };
    saveMock.mockResolvedValue(okResult(created, 1));
    fireEvent.click(screen.getByRole('button', { name: 'Создать флэт' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const arg = saveMock.mock.calls[0][0];
    expect(arg.base).toBeNull();
    expect(arg.draft).toMatchObject({ id: 'khudi-klassika', garment_type: 'hoodie', sku_codes: ['H-001'], typical: false });
    expect(Object.keys(arg.files)).toEqual(['front']);
    await waitFor(() => expect(toasts('success')).toContain('Флэт создан'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Худи классика' })));
    await waitFor(() => expect(where.search).toContain('flat=khudi-klassika'));
  });

  it('SVG со скриптом и обработчиками: «Из файла убрано» схлопнуто; PNG — отказ текстом', async () => {
    flatsRow = { exists: false, value: null };
    renderEditor({ flatId: 'new' });
    const input = await screen.findByLabelText('SVG первого вида');
    const evil = SVG.replace('<g id="garment">', '<script>alert(1)</script><g id="garment" onclick="x()">');
    await pick(input, file(evil));
    expect(await screen.findByText('Из файла убрано:')).toBeInTheDocument();
    expect(screen.getByText('скрипты')).toBeInTheDocument();
    expect(screen.getByText('обработчики событий')).toBeInTheDocument();
    await pick(input, new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'a.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Силуэт — только SVG');
  });
});
