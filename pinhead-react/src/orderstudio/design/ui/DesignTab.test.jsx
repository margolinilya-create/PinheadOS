import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import { useStore } from '../../../store/useStore';
import * as confirmStore from '../../../store/useConfirmStore';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../../model/factory';
import { useSalesStore, __resetSalesStoreForTests } from '../../store/useSalesStore';
import { useOrderPrice } from '../../screens/useOrderPrice';
import { useDesignStore } from '../store/useDesignStore';
import { catalog, flat as makeFlat } from '../fixtures.testutil';
import { newPlacedPrint, parseLayout } from '../model/layout';
import { artworkPipeline } from './useArtworkActions';
import { clearFeature, setFeature } from '../../../config/features';

/**
 * Вкладка «Дизайн» в jsdom: konva подменён простыми div (konva — в e2e),
 * справочник флэтов и картинки — заготовки. Заказ — настоящий стор продаж.
 */
const h = vi.hoisted(() => ({ catalog: null, status: 'ready' }));

vi.mock('./konva', () => {
  const box = (kind) => function KonvaBox({ children }) {
    return <div data-konva={kind}>{children}</div>;
  };
  return {
    Stage: box('Stage'), Layer: box('Layer'), Group: box('Group'), Rect: box('Rect'), Line: box('Line'),
    Text: function Text({ text }) { return <span>{text}</span>; },
    Image: function KImage() { return <div data-konva="Image" />; },
    Transformer: function Transformer() { return <div data-konva="Transformer" />; },
  };
});
vi.mock('../assets/useFlatImage', () => ({
  useFlatImage: () => ({ status: 'ready', image: {}, flatMm: { w: 600, h: 760 } }),
}));
vi.mock('../assets/artworkImages', async (orig) => ({
  ...(await orig()),
  loadArtworkImage: () => Promise.resolve(null),
}));
vi.mock('../assets/flatImages', async (orig) => ({
  ...(await orig()),
  loadFlatMarkup: () => Promise.resolve({
    markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><path d="M0 0h600v760H0z"/></svg>',
    flatMm: { w: 600, h: 760 },
    removed: [],
  }),
}));
vi.mock('../catalog/useFlatsCatalog', () => ({
  useFlatsCatalog: () => ({ status: h.status, catalog: h.catalog, issues: [], reload: vi.fn() }),
}));

const printFilesMock = vi.hoisted(() => ({ build: vi.fn(), save: vi.fn() }));
vi.mock('../export/printFiles', () => ({
  buildPrintFiles: printFilesMock.build.mockImplementation(async () => ({ zip: new Uint8Array([1]), fileName: 'PH-TEST-print-files.zip', count: 1, notes: [] })),
  rasterizeInBrowser: vi.fn(),
}));
vi.mock('../../../utils/saveBlob', () => ({ saveBlob: printFilesMock.save }));
import DesignTab from './DesignTab';

const SKU = SKU_CATALOG_DEFAULT.find((s) => s.code === 'T-003');
const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const FLAT_A = makeFlat({ sku_codes: [SKU.code] });
const FLAT_B = makeFlat({ id: 'tshirt-other', name: 'Футболка другая', sku_codes: [] });
const ASSET = { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false };
const placed = (flat = FLAT_A, view = 'front') => newPlacedPrint(ASSET, `orders/${ORDER_ID}/logo/a.png`, view === 'front' ? 'chest' : 'back', {
  flat, zonesCatalog: ZONES_CATALOG_DEFAULT, category: SKU.category, view, itemKind: 'sku', method: 'dtf',
});

const item = (over = {}) => newSalesItem({
  sku_code: SKU.code,
  product_type: SKU.name,
  fit: SKU.fit,
  size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 50 } }] },
  ...over,
});

/** Вкладка с ценой, как её монтирует рабочее место */
function Harness({ readOnly = false, compact = false }) {
  const order = useSalesStore((s) => s.current);
  const price = useOrderPrice(order);
  const it = order.items[0];
  return (
    <DesignTab
      order={order}
      item={it}
      price={price?.items.find((p) => p.key === it.key) ?? null}
      readOnly={readOnly}
      compact={compact}
      onOpenItem={() => {}}
    />
  );
}

function setup(it, opts = {}) {
  const order = newSalesOrder({ id: ORDER_ID, items: [it], status: opts.status ?? 'draft' });
  useSalesStore.setState({ current: order, currentLoading: false, saveState: opts.saveState ?? 'clean' });
  // Настоящий `edit` — из начального состояния: в текущем может остаться шпион прошлого теста
  const real = useSalesStore.getInitialState().edit;
  const edit = vi.fn((fn) => real(fn));
  useSalesStore.setState({ edit });
  const utils = render(<Harness readOnly={opts.readOnly} compact={opts.compact} />);
  return { ...utils, edit };
}

const current = () => useSalesStore.getState().current.items[0];

/** Панель — своим чанком (`React.lazy`): ждём, пока заглушка (`aria-busy`) сменится панелью */
async function panelReady() {
  await waitFor(() => expect(screen.getByRole('complementary', { name: 'Панель дизайна' })).not.toHaveAttribute('aria-busy'));
}

beforeEach(() => {
  vi.useRealTimers();
  __resetSalesStoreForTests();
  useDesignStore.getState().reset();
  useStore.setState({ skuCatalog: [SKU], zonesCatalog: ZONES_CATALOG_DEFAULT, categoryRules: [] });
  h.catalog = catalog([FLAT_A, FLAT_B]);
  h.status = 'ready';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DesignTab — открытие', () => {
  it('открытие ничего не пишет: edit не вызван, flat_id пуст; холст и маркер на месте', async () => {
    const { edit, container } = setup(item());
    expect(screen.getByRole('application', { name: /Холст: Футболка \(тест\), вид перед/ })).toBeInTheDocument();
    expect(container.querySelector('[data-design-canvas]')).not.toBeNull();
    await act(async () => {});
    expect(edit).not.toHaveBeenCalled();
    expect(current().flat_id).toBe('');
    expect(useDesignStore.getState().past).toEqual([]);
  });

  it('нет флэта для модели — плашка «нет силуэта», холста нет', () => {
    h.catalog = catalog([makeFlat({ categories: ['hoodies'], sku_codes: [] })]);
    setup(item());
    expect(screen.getByText(/Для этой модели нет силуэта/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Открыть нанесения' })).toBeInTheDocument();
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('нет модели — «Сначала выберите модель»', () => {
    h.catalog = catalog([makeFlat({ sku_codes: [], categories: ['hoodies'] })]);
    setup(item({ sku_code: '', product_type: '' }));
    expect(screen.getByText(/Сначала выберите модель/)).toBeInTheDocument();
  });

  it('не черновик — кнопок правки нет, PDF доступен', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }), { status: 'production', saveState: 'locked', readOnly: true });
    await panelReady();
    expect(screen.getByRole('button', { name: /^Нанесение 1 · / })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Загрузить логотип' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Снять с изделия/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Дублировать/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Скачать PDF макета' })).toBeEnabled();
  });

  it('≤ 760 — статичное превью <img>, без холста', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }), { compact: true });
    expect(screen.queryByRole('application')).toBeNull();
    const img = await screen.findByRole('img', { name: /Футболка \(тест\), вид перед: нанесений 1/ });
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('DesignTab — правка', () => {
  it('инспектор: Ширина → width_mm и цена позиции меняются, шаг в истории', async () => {
    const p = placed();
    setup(item({ flat_id: FLAT_A.id, prints: [p] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    const priceBefore = screen.getByRole('heading', { name: /Цена за штуку/ }).textContent;
    const width = await screen.findByLabelText('Ширина, мм');
    fireEvent.change(width, { target: { value: '280' } });
    fireEvent.blur(width);
    expect(current().prints[0].width_mm).toBe(280);
    expect(current().prints[0].height_mm).toBe(Math.round(280 * 80 / 120));
    expect(useDesignStore.getState().past).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Цена за штуку/ }).textContent).not.toBe(priceBefore));
  });

  it('цена позиции: у выбранного нанесения — строка техники (плёнка DTF), до выбора её нет (веха 5в)', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    const section = screen.getByRole('region', { name: 'Цена позиции' });
    expect(section.textContent).not.toMatch(/Плёнка/);
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    await waitFor(() => expect(section.textContent).toMatch(/Нанесение 1 — Плёнка: 1 м на \d+ шт \(\d+ в ряд\)/));
  });

  it('«Снять с изделия» в списке — строка остаётся, «Вернуть» возвращает раскладку', async () => {
    const p = placed();
    setup(item({ flat_id: FLAT_A.id, prints: [p] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: 'Снять с изделия нанесение 1' }));
    expect(current().prints).toHaveLength(1);
    expect(current().prints[0].layout).toBeNull();
    const back = await screen.findByRole('button', { name: 'Вернуть' });
    await waitFor(() => expect(back).toHaveFocus());
    fireEvent.click(back);
    expect(parseLayout(current().prints[0].layout)).not.toBeNull();
  });

  it('смена силуэта: подтверждение и перенос, flat_id новый', async () => {
    const ask = vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    fireEvent.change(screen.getByLabelText('Силуэт'), { target: { value: FLAT_B.id } });
    await waitFor(() => expect(current().flat_id).toBe(FLAT_B.id));
    expect(ask).toHaveBeenCalledTimes(1);
    expect(parseLayout(current().prints[0].layout).flat_id).toBe(FLAT_B.id);
  });

  it('смена силуэта отменена — ничего не записано', async () => {
    const ask2 = vi.spyOn(confirmStore, 'confirm').mockResolvedValue(false);
    const { edit } = setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    fireEvent.change(screen.getByLabelText('Силуэт'), { target: { value: FLAT_B.id } });
    await act(async () => {});
    expect(ask2).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(current().flat_id).toBe(FLAT_A.id);
  });

  it('строка без вида — в «Без холста»; поля строки выбранного — под раскрытием', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed(), newSalesPrint({ zone: 'Рукав левый' })] }));
    await panelReady();
    const free = screen.getByRole('region', { name: 'Нанесения без холста' });
    expect(within(free).getByText(/Нанесение 2 · Рукав левый/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    expect(await screen.findByText('Цвета, Pantone, эффект')).toBeInTheDocument();
    expect(await screen.findAllByLabelText('Техника')).toHaveLength(1);
  });
});

describe('DesignTab — подложка нового логотипа (обход, H-2)', () => {
  it.each([
    ['Сиреневый (14-02)', 'color'],
    ['Белый (01-01)', 'white'],
  ])('изделие «%s» — в конвейер логотипа уходит подложка %s', async (color, textile) => {
    const addArtworkFile = vi.fn().mockResolvedValue(null);
    vi.spyOn(artworkPipeline, 'load').mockResolvedValue({ addArtworkFile, addExistingArtwork: vi.fn() });
    const { container } = setup(item({ size_grid: { sizes: ['M'], rows: [{ color, sizes: { M: 50 } }] } }));
    await panelReady();
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    await waitFor(() => expect(addArtworkFile).toHaveBeenCalledTimes(1));
    expect(addArtworkFile.mock.calls[0][1]).toMatchObject({ textile });
  });
});

describe('DesignTab — раскладка, которую холст не показывает (ревью 6б, раунд 1)', () => {
  it('силуэт позиции снят, другого нет: «Освободить раскладку» — строка снова обычная', async () => {
    h.catalog = catalog([{ ...FLAT_A, active: false }]);
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    expect(screen.queryByRole('application')).toBeNull();
    const free = screen.getByRole('region', { name: 'Нанесения без холста' });
    expect(within(free).getByText(/раскладка для силуэта, которого здесь нет/)).toBeInTheDocument();
    fireEvent.click(within(free).getByRole('button', { name: 'Освободить раскладку нанесения 1' }));
    expect(current().prints).toHaveLength(1);
    expect(current().prints[0].layout).toBeNull();
    expect(useDesignStore.getState().past.at(-1).label).toBe('Освободить раскладку');
  });

  it('в новой версии силуэта нет зоны: строка в «Без холста» с «Освободить раскладку»', async () => {
    const v2 = makeFlat({ sku_codes: [SKU.code], version: 2 });
    v2.views = [{ ...v2.views[0], print_areas: [] }, v2.views[1]];
    h.catalog = catalog([v2]);
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    const free = screen.getByRole('region', { name: 'Нанесения без холста' });
    fireEvent.click(within(free).getByRole('button', { name: 'Освободить раскладку нанесения 1' }));
    expect(current().prints[0].layout).toBeNull();
  });

  it('только чтение — причина видна, кнопки нет', () => {
    h.catalog = catalog([{ ...FLAT_A, active: false }]);
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }), { status: 'production', saveState: 'locked', readOnly: true });
    const free = screen.getByRole('region', { name: 'Нанесения без холста' });
    expect(within(free).getByText(/раскладка для силуэта, которого здесь нет/)).toBeInTheDocument();
    expect(within(free).queryByRole('button', { name: /Освободить раскладку/ })).toBeNull();
  });

  it('обычная строка без холста (рукав) — без «Освободить раскладку»', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed(), newSalesPrint({ zone: 'Рукав левый' })] }));
    await panelReady();
    const free = screen.getByRole('region', { name: 'Нанесения без холста' });
    expect(within(free).queryByRole('button', { name: /Освободить раскладку/ })).toBeNull();
  });
});

describe('DesignTab — силуэт не от модели (B1, веха 5в)', () => {
  const HOODIE_SKU = { ...SKU, code: 'H-TEST', name: 'Худи (тест)', category: 'hoodies' };
  const HOODIE_FLAT = makeFlat({ id: 'hoodie-test', name: 'Худи (тест)', garment_type: 'hoodie', categories: ['hoodies'] });

  beforeEach(() => {
    useStore.setState({ skuCatalog: [SKU, HOODIE_SKU] });
    h.catalog = catalog([FLAT_A, FLAT_B, HOODIE_FLAT]);
  });

  it('худи на флэте футболки: в выборе силуэта нет чужих футболок, плашка называет причину и предлагает худи', () => {
    setup(item({ sku_code: HOODIE_SKU.code, product_type: HOODIE_SKU.name, flat_id: FLAT_A.id }));
    const options = within(screen.getByLabelText('Силуэт')).getAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => t.startsWith('Футболка другая'))).toBe(false);
    expect(options.some((t) => t.startsWith('Худи (тест)'))).toBe(true);
    expect(screen.getByText(/Силуэт «Футболка \(тест\)» — от другой модели/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перенести на «Худи (тест)»' })).toBeInTheDocument();
  });

  it('пока нанесения на чужом силуэте — новый логотип не ставится: кнопка с причиной, конвейер не грузится', async () => {
    const load = vi.spyOn(artworkPipeline, 'load');
    const { edit } = setup(item({ sku_code: HOODIE_SKU.code, product_type: HOODIE_SKU.name, flat_id: FLAT_A.id }));
    await panelReady();
    const btn = screen.getByRole('button', { name: 'Загрузить логотип' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription(/Сначала перенесите нанесения на силуэт модели/);
    fireEvent.click(btn);
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('проверка макета первым пунктом называет чужой силуэт', async () => {
    setup(item({ sku_code: HOODIE_SKU.code, product_type: HOODIE_SKU.name, flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    expect(screen.getByRole('region', { name: 'Проверка макета' })).toHaveTextContent(/Серьёзно: Силуэт — от другой модели/);
  });
});

describe('DesignTab — «Стандарты Pinhead» (веха 5в, Э2)', () => {
  afterEach(() => clearFeature('designStudio'));

  it('без выбора — чипы видны, недоступны с причиной; подсказка размера — описанием, не именем', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    const group = await screen.findByRole('group', { name: 'Стандарты Pinhead' });
    const chest = within(group).getByRole('button', { name: 'Центр груди' });
    expect(chest).toHaveAttribute('aria-disabled', 'true');
    expect(chest).toHaveAccessibleDescription('250 мм, 75 мм от горловины Выберите нанесение на холсте');
  });

  it('клик у выбранного — размер стандарта и один шаг истории «Центр груди (стандарт)»', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    const group = await screen.findByRole('group', { name: 'Стандарты Pinhead' });
    const chest = within(group).getByRole('button', { name: 'Центр груди' });
    expect(chest).not.toHaveAttribute('aria-disabled');
    fireEvent.click(chest);
    expect(current().prints[0].width_mm).toBe(250);
    const { past } = useDesignStore.getState();
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe('Центр груди (стандарт)');
    // Кнопок пресетов в инспекторе нет — одна точка входа
    expect(screen.queryByRole('group', { name: 'Положение одной кнопкой' })).toBeNull();
  });

  it('только чтение — чипов нет', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }), { readOnly: true });
    await panelReady();
    expect(screen.queryByRole('group', { name: 'Стандарты Pinhead' })).toBeNull();
  });

  it('флаг выключен — прежний вид: чипов нет, пресеты в инспекторе', async () => {
    setFeature('designStudio', false);
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    expect(await screen.findByRole('group', { name: 'Положение одной кнопкой' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Стандарты Pinhead' })).toBeNull();
  });
});

describe('DesignTab — проверки под холстом и статус нанесения (веха 5в, Э2)', () => {
  it('замечание видно под холстом, сводка — живым регионом; строка слоя — «Проверить»; в панели списка нет', async () => {
    const tiny = { ...placed(), width_mm: 10, height_mm: 7 };
    setup(item({ flat_id: FLAT_A.id, prints: [tiny] }));
    await panelReady();
    const checks = await screen.findByRole('region', { name: 'Проверка макета' });
    expect(within(checks).getByText(/меньшая сторона — от 20 мм/)).toBeInTheDocument();
    expect(checks.textContent).toMatch(/1 замечание/);
    await waitFor(() => expect(within(checks).getByRole('status')).toHaveTextContent('1 замечание'));
    expect(screen.getAllByRole('region', { name: 'Проверка макета' })).toHaveLength(1);
    const row = screen.getByRole('button', { name: /^Нанесение 1 · / });
    expect(row).toHaveAccessibleDescription('Проверить');
  });

  it('«Показать» выбирает нанесение; без замечаний — «Замечаний нет», статус «Готово»', async () => {
    const tiny = { ...placed(), width_mm: 10, height_mm: 7 };
    setup(item({ flat_id: FLAT_A.id, prints: [tiny] }));
    await panelReady();
    const checks = await screen.findByRole('region', { name: 'Проверка макета' });
    fireEvent.click(within(checks).getByRole('button', { name: 'Показать' }));
    expect(useDesignStore.getState().selectedPrintKey).toBe(tiny.key);
  });

  it('нанесение в норме — «Замечаний нет» и «Готово»', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    const checks = await screen.findByRole('region', { name: 'Проверка макета' });
    expect(checks.textContent).toMatch(/Замечаний нет/);
    expect(screen.getByRole('button', { name: /^Нанесение 1 · / })).toHaveAccessibleDescription('Готово');
  });
});

describe('DesignTab — вид холста и цвет ткани (веха 5в, Э2)', () => {
  it('«Как на изделии» — переключатель с aria-pressed, холст в режиме изделия, в заказ ничего не пишется; работает в только чтении', async () => {
    const { edit } = setup(item({ flat_id: FLAT_A.id, prints: [placed()] }), { readOnly: true });
    const group = await screen.findByRole('group', { name: 'Вид холста' });
    const garment = within(group).getByRole('button', { name: 'Как на изделии' });
    expect(garment).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(garment);
    expect(garment).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Разметка' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('application')).toHaveAccessibleName(/как на изделии$/);
    expect(edit).not.toHaveBeenCalled();
  });

  it('цвет ткани — чипы по цветам сетки, выбор меняет только показ', async () => {
    const it2 = item({
      flat_id: FLAT_A.id,
      prints: [placed()],
      size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 10 } }, { color: 'Чёрный (15-01)', sizes: { M: 5 } }, { color: 'Белый (01-01)', sizes: { M: 1 } }] },
    });
    const { edit } = setup(it2);
    const group = await screen.findByRole('group', { name: 'Показать на цвете' });
    const chips = within(group).getAllByRole('button');
    expect(chips.map((b) => b.textContent)).toEqual(['Белый (01-01)', 'Чёрный (15-01)']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chips[1]);
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
    expect(useDesignStore.getState().fabricColor).toBe('Чёрный (15-01)');
    expect(edit).not.toHaveBeenCalled();
  });

  it('флаг выключен — ни переключателя, ни цвета; холст всегда с разметкой', async () => {
    setFeature('designStudio', false);
    useDesignStore.getState().setDisplay('garment');
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    expect(screen.queryByRole('group', { name: 'Вид холста' })).toBeNull();
    expect(screen.getByRole('application')).not.toHaveAccessibleName(/как на изделии/);
    clearFeature('designStudio');
  });
});

describe('DesignTab — итог позиции (веха 5в, Э2)', () => {
  it('«Файлы печати» — сборка по клику, архив скачивается, заказ не пишется (Э4а)', async () => {
    const { edit } = setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    const bar = await screen.findByRole('region', { name: 'Итог позиции' });
    const btn = within(bar).getByRole('button', { name: 'Файлы печати' });
    expect(btn).not.toHaveAttribute('aria-disabled');
    fireEvent.click(btn);
    await waitFor(() => expect(printFilesMock.build).toHaveBeenCalled());
    await waitFor(() => expect(printFilesMock.save).toHaveBeenCalledWith(expect.any(Blob), 'PH-TEST-print-files.zip'));
    expect(edit).not.toHaveBeenCalled();
  });

  it('нанесения, цена за штуку и за позицию — как цена позиции', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    const bar = await screen.findByRole('region', { name: 'Итог позиции' });
    const unit = screen.getByRole('heading', { name: /Цена за штуку/ }).textContent.replace('Цена за штуку: ', '');
    expect(bar.textContent).toMatch(/^1 нанесение·/);
    expect(bar.textContent).toContain(`${unit}/шт`);
    expect(bar.textContent).toMatch(/₽ за позицию/);
  });
  it('пустая сетка — «Цена не посчитана»', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [], size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 0 } }] } }));
    const bar = await screen.findByRole('region', { name: 'Итог позиции' });
    expect(bar.textContent).toMatch(/^Нанесений нет·Цена не посчитана/);
    const btn = within(bar).getByRole('button', { name: 'Файлы печати' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAccessibleDescription('Нет нанесений с макетом и размером в мм');
  });
});

describe('DesignTab — копия на другой вид и Ctrl+D (веха 5в, Э2)', () => {
  it('«Копировать на вид» → копия на спине, вид — спина, выбор — копия, один шаг истории', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    const group = await screen.findByRole('group', { name: 'Копировать нанесение 1 на вид' });
    fireEvent.click(within(group).getByRole('button', { name: /Спина/ }));
    const prints = current().prints;
    expect(prints).toHaveLength(2);
    expect(parseLayout(prints[1].layout)?.view).toBe('back');
    const s = useDesignStore.getState();
    expect(s.view).toBe('back');
    expect(s.selectedPrintKey).toBe(prints[1].key);
    expect(s.past.map((x) => x.label)).toEqual(['Копия на вид']);
  });

  it('Ctrl+D на холсте — дубль и выбор копии', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    fireEvent.keyDown(screen.getByRole('application'), { key: 'd', code: 'KeyD', ctrlKey: true });
    await waitFor(() => expect(current().prints).toHaveLength(2));
    expect(useDesignStore.getState().selectedPrintKey).toBe(current().prints[1].key);
  });

  it('Ctrl+C → Ctrl+V слоя — вставка копии; чужая метка — ничего', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    const canvas = screen.getByRole('application');
    const store = {};
    const data = { files: [], setData: (t, v) => { store[t] = v; }, getData: (t) => store[t] ?? '' };
    fireEvent.copy(canvas, { clipboardData: data });
    fireEvent.paste(canvas, { clipboardData: { files: [], getData: () => 'другой:ключ' } });
    await act(async () => {});
    expect(current().prints).toHaveLength(1);
    fireEvent.paste(canvas, { clipboardData: data });
    await waitFor(() => expect(current().prints).toHaveLength(2));
  });
});

describe('DesignTab — лист «Выкройка» (веха 5в, Э2б)', () => {
  const withPattern = (f) => ({
    ...f,
    views: f.views.map((v) => ({ ...v, pattern: { contour_mm: [[20, 10], [580, 10], [600, 730], [0, 730]], count: 1 } })),
  });

  it('без лекал — кнопки «Выкройка» нет', async () => {
    setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    const group = await screen.findByRole('group', { name: 'Вид холста' });
    expect(within(group).queryByRole('button', { name: 'Выкройка' })).toBeNull();
  });

  it('с лекалами — лист картинкой вместо холста, ничего не пишет; «Править деталь» — разметка на этом виде', async () => {
    h.catalog = catalog([withPattern(FLAT_A), FLAT_B]);
    const { edit } = setup(item({ flat_id: FLAT_A.id, prints: [placed()] }));
    const group = await screen.findByRole('group', { name: 'Вид холста' });
    fireEvent.click(within(group).getByRole('button', { name: 'Выкройка' }));
    const sheet = await screen.findByRole('region', { name: 'Выкройка' });
    expect(await within(sheet).findByRole('img', { name: /^Выкройка: перед, спина; нанесений 1$/ })).toBeInTheDocument();
    expect(screen.queryByRole('application')).toBeNull();
    fireEvent.click(within(within(sheet).getByRole('group', { name: 'Править деталь' })).getByRole('button', { name: 'Спина' }));
    expect(useDesignStore.getState().display).toBe('markup');
    expect(useDesignStore.getState().view).toBe('back');
    expect(await screen.findByRole('application')).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
  });
});

