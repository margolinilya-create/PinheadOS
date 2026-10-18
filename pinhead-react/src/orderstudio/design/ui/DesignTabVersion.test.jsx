import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { SKU_CATALOG_DEFAULT } from '../../../data/skuCatalog';
import { useStore } from '../../../store/useStore';
import * as confirmStore from '../../../store/useConfirmStore';
import { newSalesItem, newSalesOrder } from '../../model/factory';
import { useSalesStore, __resetSalesStoreForTests } from '../../store/useSalesStore';
import { useDesignStore } from '../store/useDesignStore';
import { catalog, flat as makeFlat } from '../fixtures.testutil';
import { sleevedFlat, versionedFlat } from '../fixtures5b.testutil';
import { newPlacedPrint, parseLayout } from '../model/layout';
import { flatAtVersion } from '../catalog/flatVersion';

/**
 * Вкладка «Дизайн» и версии флэта (веха 5б, задача 5; К15, Review Focus 1):
 * открытие позиции на прежней версии ничего не пишет, холст и правки — по
 * версии позиции, перенос — по кнопке и только в черновике; точный силуэт;
 * вкладки видов с рукавами. konva подменён простыми div, как в `DesignTab.test`.
 */
const h = vi.hoisted(() => ({ catalog: null }));

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
const flatImage = vi.hoisted(() => ({ paths: [] }));
vi.mock('../assets/useFlatImage', () => ({
  useFlatImage: (flat, view) => {
    flatImage.paths.push(flat?.views.find((v) => v.kind === view)?.svg_path);
    return { status: 'ready', image: {}, flatMm: { w: 600, h: 760 } };
  },
}));
vi.mock('../assets/artworkImages', async (orig) => ({
  ...(await orig()),
  loadArtworkImage: () => Promise.resolve(null),
}));
vi.mock('../catalog/useFlatsCatalog', () => ({
  useFlatsCatalog: () => ({ status: 'ready', catalog: h.catalog, issues: [], reload: vi.fn() }),
}));

import DesignTab from './DesignTab';

const SKU = SKU_CATALOG_DEFAULT.find((s) => s.code === 'T-003');
const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const PATH = `orders/${ORDER_ID}/logo/a.png`;
const ASSET = { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40, size_estimated: false, has_preview: false };
const FLAT = { ...versionedFlat(), sku_codes: [SKU.code] };
const V1 = flatAtVersion(FLAT, 1);
const onV1 = (areaId = 'chest', view = 'front') => newPlacedPrint(ASSET, PATH, areaId, {
  flat: V1, zonesCatalog: ZONES_CATALOG_DEFAULT, category: SKU.category, view, itemKind: 'sku', method: 'dtf',
});

const item = (over = {}) => newSalesItem({
  sku_code: SKU.code,
  product_type: SKU.name,
  fit: SKU.fit,
  size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 50 } }] },
  ...over,
});

function Harness({ readOnly = false }) {
  const order = useSalesStore((s) => s.current);
  return <DesignTab order={order} item={order.items[0]} price={null} readOnly={readOnly} onOpenItem={() => {}} />;
}

function setup(it, opts = {}) {
  const order = newSalesOrder({ id: ORDER_ID, items: [it], status: opts.status ?? 'draft' });
  useSalesStore.setState({ current: order, currentLoading: false, saveState: opts.saveState ?? 'clean' });
  const real = useSalesStore.getInitialState().edit;
  const edit = vi.fn((fn) => real(fn));
  useSalesStore.setState({ edit });
  return { ...render(<Harness readOnly={opts.readOnly} />), edit };
}

const current = () => useSalesStore.getState().current.items[0];
const versionOf = (p) => parseLayout(p.layout)?.flat_version;

async function panelReady() {
  await waitFor(() => expect(screen.getByRole('complementary', { name: 'Панель дизайна' })).not.toHaveAttribute('aria-busy'));
}

beforeEach(() => {
  vi.useRealTimers();
  __resetSalesStoreForTests();
  useDesignStore.getState().reset();
  useStore.setState({ skuCatalog: [SKU], zonesCatalog: ZONES_CATALOG_DEFAULT, categoryRules: [], extrasCatalog: [] });
  h.catalog = catalog([FLAT]);
  flatImage.paths = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('позиция на прежней версии силуэта', () => {
  it('открытие ничего не пишет; холст по v1; плашка «Силуэт обновлён» с переносом', async () => {
    const { edit } = setup(item({ flat_id: FLAT.id, prints: [onV1()] }));
    await panelReady();
    await act(async () => {});
    expect(edit).not.toHaveBeenCalled();
    expect(screen.getByText(/Силуэт обновлён до версии 2\. Нанесения стоят по версии 1\./)).toBeInTheDocument();
    expect(flatImage.paths).toContain(`flats/${FLAT.id}/v1/front.svg`);
    expect(flatImage.paths).not.toContain(`flats/${FLAT.id}/v2/front.svg`);
  });

  it('«Перенести на версию 2» — один edit, раскладка на текущей версии', async () => {
    const { edit } = setup(item({ flat_id: FLAT.id, prints: [onV1()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести на версию 2' }));
    expect(edit).toHaveBeenCalledTimes(1);
    expect(versionOf(current().prints[0])).toBe(2);
    expect(screen.getByText('Нанесения перенесены на версию 2 силуэта')).toHaveAttribute('role', 'status');
    expect(screen.queryByText(/Силуэт обновлён до версии 2/)).toBeNull();
  });

  it('карман пропал в v2 — после переноса снят с холста, строка осталась, причина названа', () => {
    setup(item({ flat_id: FLAT.id, prints: [onV1('pocket')] }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести на версию 2' }));
    expect(current().prints).toHaveLength(1);
    expect(current().prints[0].layout).toBeNull();
    expect(screen.getByText(/^Сняты с холста: 1 — в версии 2 силуэта нет таких зон/)).toHaveAttribute('role', 'status');
  });

  it('не черновик — плашка без кнопки, холст по v1', async () => {
    const { edit } = setup(item({ flat_id: FLAT.id, prints: [onV1()] }), { status: 'production', saveState: 'locked', readOnly: true });
    await act(async () => {});
    expect(screen.getByText(/Силуэт обновлён до версии 2/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Перенести на версию/ })).toBeNull();
    expect(flatImage.paths).toContain(`flats/${FLAT.id}/v1/front.svg`);
    expect(edit).not.toHaveBeenCalled();
  });

  it('правка размера на позиции v1 оставляет flat_version: 1 (PlaceCtx — флэт версии позиции)', async () => {
    setup(item({ flat_id: FLAT.id, prints: [onV1()] }));
    await panelReady();
    fireEvent.click(screen.getByRole('button', { name: /^Нанесение 1 · / }));
    const width = await screen.findByLabelText('Ширина, мм');
    fireEvent.change(width, { target: { value: '90' } });
    fireEvent.blur(width);
    expect(current().prints[0].width_mm).toBe(90);
    expect(versionOf(current().prints[0])).toBe(1);
  });

  it('новое размещение («Логотипы заказа») на позиции v1 — flat_version: 1', async () => {
    setup(item({ flat_id: FLAT.id, prints: [onV1()] }));
    await panelReady();
    fireEvent.click(screen.getByText(/Логотипы заказа/));
    fireEvent.click(screen.getByRole('button', { name: 'Поставить «logo.png»' }));
    await waitFor(() => expect(current().prints).toHaveLength(2));
    expect(current().prints.map(versionOf)).toEqual([1, 1]);
  });
});

describe('точный силуэт для позиции на типовом (Р12)', () => {
  const TYPICAL = makeFlat({ id: 'tshirt-typical', name: 'Футболка типовая', sku_codes: [] });
  const EXACT = makeFlat({ id: 'tshirt-exact', name: 'Футболка Regular, лекало', typical: false, sku_codes: [SKU.code], categories: [] });
  const onTypical = () => newPlacedPrint(ASSET, PATH, 'chest', {
    flat: TYPICAL, zonesCatalog: ZONES_CATALOG_DEFAULT, category: SKU.category, view: 'front', itemKind: 'sku', method: 'dtf',
  });

  it('плашка видна, открытие ничего не пишет; «Перенести нанесения» → flat_id точный', async () => {
    h.catalog = catalog([TYPICAL, EXACT]);
    vi.spyOn(confirmStore, 'confirm').mockResolvedValue(true);
    const { edit } = setup(item({ flat_id: TYPICAL.id, prints: [onTypical()] }));
    expect(screen.getByText(/Для модели появился точный силуэт «Футболка Regular, лекало»/)).toBeInTheDocument();
    expect(edit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Перенести нанесения' }));
    await waitFor(() => expect(current().flat_id).toBe(EXACT.id));
    expect(parseLayout(current().prints[0].layout).flat_id).toBe(EXACT.id);
  });

  it('позиция уже на точном — плашки нет', () => {
    h.catalog = catalog([TYPICAL, EXACT]);
    setup(item({ flat_id: EXACT.id }));
    expect(screen.queryByText(/появился точный силуэт/)).toBeNull();
  });
});

describe('вкладки видов: рукава (5б)', () => {
  it('у флэта без рукавов — только перед и спина', () => {
    h.catalog = catalog([makeFlat({ sku_codes: [SKU.code] })]);
    setup(item());
    const tabs = within(screen.getByRole('tablist', { name: 'Вид изделия' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Перед', 'Спина']);
  });

  it('с левым рукавом — вкладка «Левый рукав»; стрелки переключают вид и фокус', () => {
    h.catalog = catalog([{ ...sleevedFlat('tshirt-test', 1, ['sleeve_left']), sku_codes: [SKU.code] }]);
    setup(item());
    const list = screen.getByRole('tablist', { name: 'Вид изделия' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Перед', 'Спина', 'Левый рукав']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(tabs[0], { key: 'End' });
    const sleeve = within(list).getByRole('tab', { name: 'Левый рукав' });
    expect(sleeve).toHaveAttribute('aria-selected', 'true');
    expect(sleeve).toHaveFocus();
    expect(screen.getByRole('application', { name: /вид левый рукав/ })).toBeInTheDocument();
    fireEvent.keyDown(sleeve, { key: 'ArrowRight' });
    expect(within(list).getByRole('tab', { name: 'Перед' })).toHaveAttribute('aria-selected', 'true');
  });
});
