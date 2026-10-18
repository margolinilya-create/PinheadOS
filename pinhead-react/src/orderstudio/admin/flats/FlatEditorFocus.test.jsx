import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { confirm } from '../../../store/useConfirmStore';
import { downloadFlatSvg } from '../../api/garmentFlats';
import { flat } from '../../design/fixtures.testutil';
import { sleevedFlat } from '../../design/fixtures5b.testutil';
import { saveFlat } from './saveFlat';
import { renderEditor, SVG, ZONES } from './flatEditor.testutil';

/**
 * Правила фокуса редактора флэта (план 5б, задача 6б, раздел «Фокус») —
 * по тесту на пункт. Холст — заглушка по контракту задачи 6а: `]` выбирает
 * следующую зону через `onSelectArea`, фокус остаётся на холсте.
 */
vi.mock('../../../lib/catalogs', async (orig) => ({ ...(await orig()), fetchCatalogKey: vi.fn() }));
vi.mock('./saveFlat', async (orig) => ({ ...(await orig()), saveFlat: vi.fn() }));
vi.mock('../../api/garmentFlats', async (orig) => ({ ...(await orig()), downloadFlatSvg: vi.fn() }));
vi.mock('../../../store/useConfirmStore', async (orig) => ({ ...(await orig()), confirm: vi.fn() }));
vi.mock('./canvas/FlatCanvas', () => ({
  default: (p) => (
    <button
      type="button"
      aria-label={p.label}
      onKeyDown={(e) => {
        if (e.key !== ']') return;
        const ids = p.view.print_areas.map((a) => a.id);
        p.onSelectArea(ids[(ids.indexOf(p.selectedAreaId) + 1) % ids.length]);
      }}
    />
  ),
}));

const confirmMock = vi.mocked(confirm);
let flatsRow;

beforeEach(() => {
  vi.clearAllMocks();
  flatsRow = { exists: true, value: { version: 1, flats: [flat()] } };
  vi.mocked(fetchCatalogKey).mockImplementation(async (_t, key) => (key === 'zonesCatalog' ? { exists: true, value: ZONES } : flatsRow));
  vi.mocked(downloadFlatSvg).mockResolvedValue(SVG);
});

const canvas = () => screen.findByRole('button', { name: /^Холст флэта/ });
const focused = (el) => waitFor(() => expect(document.activeElement).toBe(el));

describe('FlatEditor — фокус: зоны', () => {
  it('выбор зоны в списке панели → фокус на её «Название»', async () => {
    renderEditor({ view: 'back' });
    await canvas();
    fireEvent.click(screen.getByRole('button', { name: /^Этикетка/ }));
    await focused(screen.getByLabelText('Название'));
    expect(screen.getByLabelText('Название')).toHaveValue('Этикетка');
  });

  it('выбор на холсте (`]`) → фокус остаётся на холсте, поля показывают новую зону', async () => {
    renderEditor({ view: 'back' });
    const c = await canvas();
    c.focus();
    fireEvent.keyDown(c, { key: ']' });
    await waitFor(() => expect(screen.getByLabelText('Название')).toHaveValue('Этикетка'));
    expect(document.activeElement).toBe(c);
  });

  it('«Добавить зону» → фокус на название новой зоны', async () => {
    renderEditor();
    await canvas();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить зону' }));
    await focused(screen.getByLabelText('Название'));
    expect(screen.getByLabelText('Название')).toHaveValue('Новая зона');
  });

  it('«Удалить зону» → фокус на соседнюю строку', async () => {
    renderEditor({ view: 'back' });
    await canvas();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить зону «Спина»' }));
    await focused(screen.getByRole('button', { name: /^Этикетка/ }));
    expect(screen.queryByRole('button', { name: 'Удалить зону «Спина»' })).toBeNull();
  });

  it('«Удалить точку» → фокус на соседнюю точку', async () => {
    renderEditor();
    await canvas();
    fireEvent.click(screen.getByRole('button', { name: 'Многоугольник' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить точку 2' }));
    expect(screen.getAllByRole('button', { name: /^Удалить точку \d$/ })).toHaveLength(3);
    await focused(screen.getAllByLabelText('X, мм')[1]);
  });
});

describe('FlatEditor — фокус: виды и подтверждения', () => {
  it('«Удалить вид»: отмена — фокус обратно на кнопку; подтверждение — на вкладку соседнего вида', async () => {
    renderEditor({ view: 'back' });
    await canvas();
    fireEvent.click(screen.getByRole('tab', { name: 'Вид' }));
    const remove = screen.getByRole('button', { name: 'Удалить вид «Спина»' });
    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(remove);
    await focused(remove);
    expect(screen.getByRole('tab', { name: 'Спина' })).toBeInTheDocument();
    confirmMock.mockResolvedValueOnce(true);
    fireEvent.click(remove);
    await focused(screen.getByRole('tab', { name: 'Перед' }));
    expect(screen.queryByRole('tab', { name: 'Спина' })).toBeNull();
    expect(confirmMock.mock.calls[0][0].message).toBe('Удалить вид «Спина»? Сохранится новой версией; заказы на версии 1 сохранят спину');
  });

  it('зеркальная копия без замены → фокус на вкладку нового вида, файл отражён', async () => {
    flatsRow = { exists: true, value: { version: 1, flats: [sleevedFlat('tshirt-test', 1, ['sleeve_left'])] } };
    renderEditor({ view: 'sleeve_left' });
    await canvas();
    fireEvent.click(screen.getByRole('tab', { name: 'Вид' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сделать правый рукав зеркально' }));
    await focused(await screen.findByRole('tab', { name: 'Правый рукав' }));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Выпустить версию 2' })).toBeEnabled();
  });

  it('замена рукава: «Отмена» в подтверждении — фокус на кнопку, которая его открыла', async () => {
    flatsRow = { exists: true, value: { version: 1, flats: [sleevedFlat()] } };
    renderEditor({ view: 'sleeve_left' });
    await canvas();
    fireEvent.click(screen.getByRole('tab', { name: 'Вид' }));
    const mirror = screen.getByRole('button', { name: 'Сделать правый рукав зеркально' });
    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(mirror);
    await focused(mirror);
    expect(confirmMock.mock.calls[0][0].message).toMatch(/^Заменить правый рукав зеркальной копией левого\? Текущий правый рукав \(зон: 1\) уйдёт в версию 1/);
  });
});

describe('FlatEditor — фокус после сохранения', () => {
  it('«Выпустить версию» → фокус на бейдж версии, тост называет версию', async () => {
    renderEditor();
    await canvas();
    const x = screen.getByLabelText('X, мм');
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: '160' } });
    fireEvent.blur(x);
    const saved = flat({ version: 2 });
    vi.mocked(saveFlat).mockResolvedValue({ ok: true, flat: saved, raw: { version: 1, flats: [saved] }, released: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Выпустить версию 2' }));
    const badge = await screen.findByText('Версия 2');
    await focused(badge);
  });

  it('отказ сохранения → фокус на плашку с текстом отказа', async () => {
    renderEditor();
    await canvas();
    fireEvent.change(screen.getByLabelText('Строка ТЗ'), { target: { value: 'front_l' } });
    vi.mocked(saveFlat).mockResolvedValue({ ok: false, kind: 'files', message: 'Файл вида «Перед» не загрузился' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить флэт' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Файл вида «Перед» не загрузился');
    await focused(alert);
  });
});
