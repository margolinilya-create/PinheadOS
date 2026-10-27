import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fetchCatalogKey } from '../../../lib/catalogs';
import { downloadFlatSvg } from '../../api/garmentFlats';
import { flat } from '../../design/fixtures.testutil';
import { renderEditor, SVG, ZONES } from './flatEditor.testutil';

vi.mock('../../../lib/catalogs', async (orig) => ({ ...(await orig()), fetchCatalogKey: vi.fn() }));
vi.mock('./saveFlat', async (orig) => ({ ...(await orig()), saveFlat: vi.fn() }));
vi.mock('../../api/garmentFlats', async (orig) => ({ ...(await orig()), downloadFlatSvg: vi.fn() }));
vi.mock('./canvas/FlatCanvas', () => ({
  default: (p) => <button type="button" aria-label={p.label} data-pattern={String(Boolean(p.view?.pattern))} />,
}));

/** DXF в мм: две детали-блока AAMA — «FRONT» 560 × 720 и «BACK» */
const rect = (x, y, w, h, layer = '1') => ['0', 'LWPOLYLINE', '8', layer, '90', 4, '70', 1, '10', x, '20', y, '10', x + w, '20', y, '10', x + w, '20', y + h, '10', x, '20', y + h];
const DXF = [
  '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', 4, '0', 'ENDSEC',
  '0', 'SECTION', '2', 'BLOCKS',
  '0', 'BLOCK', '2', 'FRONT', ...rect(0, 0, 560, 720), '0', 'ENDBLK',
  '0', 'BLOCK', '2', 'BACK', ...rect(0, 0, 540, 740), '0', 'ENDBLK',
  '0', 'ENDSEC',
  '0', 'SECTION', '2', 'ENTITIES',
  '0', 'INSERT', '8', '0', '2', 'FRONT', '10', 0, '20', 0,
  '0', 'INSERT', '8', '0', '2', 'BACK', '10', 1000, '20', 0,
  '0', 'ENDSEC', '0', 'EOF',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchCatalogKey).mockImplementation(async (_t, key) => (key === 'zonesCatalog' ? { exists: true, value: ZONES } : { exists: true, value: { version: 1, flats: [flat()] } }));
  vi.mocked(downloadFlatSvg).mockResolvedValue(SVG);
});

async function openPatterns() {
  renderEditor();
  await screen.findByRole('button', { name: 'Холст флэта: Футболка (тест), вид Перед' });
  fireEvent.click(screen.getByRole('tab', { name: 'Лекала' }));
}

const upload = (name, text) => fireEvent.change(screen.getByLabelText('Загрузить лекала (DXF или SVG)'), {
  target: { files: [new File([text], name)] },
});

describe('FlatEditor — лекала (веха 5в, Э2б)', () => {
  it('DXF → детали с размерами и ролью по имени; «Поставить» → лекало у вида, сохранение — новой версией', async () => {
    await openPatterns();
    upload('tee.dxf', DXF);
    const list = await screen.findByRole('list', { name: 'Детали из файла' });
    expect(within(list).getByText('FRONT · 56 × 72 см')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Деталь').map((s) => s.value)).toEqual(['front', 'back']);
    fireEvent.click(screen.getByRole('button', { name: 'Поставить лекала на виды' }));
    const views = await screen.findByRole('list', { name: 'Лекала видов' });
    expect(within(views).getByText('Перед · 56 × 72 см · крой: 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Холст флэта: Футболка (тест), вид Перед' })).toHaveAttribute('data-pattern', 'true');
    expect(screen.getByRole('button', { name: /^Выпустить версию 2$/ })).toBeInTheDocument();
  });

  it('две детали на один вид — кнопка недоступна с причиной', async () => {
    await openPatterns();
    upload('tee.dxf', DXF);
    const roles = await screen.findAllByLabelText('Деталь');
    fireEvent.change(roles[1], { target: { value: 'front' } });
    const btn = screen.getByRole('button', { name: 'Поставить лекала на виды' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription('Две детали на «Перед» — оставьте одну');
    fireEvent.click(btn);
    expect(screen.queryByRole('list', { name: 'Лекала видов' })).toBeNull();
  });

  it('SVG без единиц — выбор единиц; не тот файл — причина', async () => {
    await openPatterns();
    upload('front.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80"><rect width="56" height="72"/></svg>');
    const unit = await screen.findByLabelText('Единицы файла (в файле не указаны)');
    fireEvent.change(unit, { target: { value: 'cm' } });
    expect(await screen.findByText('Деталь 1 · 56 × 72 см')).toBeInTheDocument();
    upload('notes.txt', 'просто текст');
    expect(await screen.findByRole('alert')).toHaveTextContent('Нужен файл DXF или SVG от программы конструктора');
  });

  it('«Убрать лекало» снимает его с вида', async () => {
    await openPatterns();
    upload('tee.dxf', DXF);
    fireEvent.click(await screen.findByRole('button', { name: 'Поставить лекала на виды' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Убрать лекало «Перед»' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Холст флэта: Футболка (тест), вид Перед' })).toHaveAttribute('data-pattern', 'false'));
  });
});
