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
