import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ZONES_CATALOG_DEFAULT } from '../../../../data/constants';
import { newSalesPrint } from '../../../model/factory';
import { useSalesStore } from '../../../store/useSalesStore';
import { useDesignStore } from '../../store/useDesignStore';
import { flat as makeFlat, CENTER_X } from '../../fixtures.testutil';
import { newPlacedPrint, placementOf } from '../../model/layout';
import { makeTransform } from './canvasMath';
import { DEFAULT_STAGE } from './useCanvasViewport';

/**
 * Холст в jsdom: konva подменён простыми div (konva — в e2e). Узлы нанесений
 * пишут свои пропсы в `h.nodes` — тест зовёт их обработчики, как konva.
 */
const h = vi.hoisted(() => ({
  nodes: new Map(),
  stage: { props: null },
  flat: { status: 'ready', image: {}, flatMm: { w: 600, h: 760 } },
}));

vi.mock('../konva', () => {
  const box = (kind) => function KonvaBox({ children }) {
    return <div data-konva={kind}>{children}</div>;
  };
  return {
    Stage: function Stage({ children, ...props }) {
      h.stage.props = props;
      return <div data-konva="Stage">{children}</div>;
    },
    Layer: box('Layer'),
    Group: box('Group'),
    Rect: box('Rect'),
    Line: box('Line'),
    Text: function Text({ text }) {
      return <span data-konva="Text">{text}</span>;
    },
    Image: function KImage(props) {
      if (props.name) h.nodes.set(props.name, props);
      return <div data-konva="Image" data-name={props.name ?? ''} data-draggable={String(Boolean(props.draggable))} />;
    },
    Transformer: function Transformer() {
      return <div data-konva="Transformer" />;
    },
  };
});

vi.mock('../../assets/useFlatImage', () => ({ useFlatImage: () => h.flat }));
vi.mock('../../assets/artworkImages', async (importOriginal) => ({
  ...(await importOriginal()),
  loadArtworkImage: () => Promise.resolve(null),
}));

import { EditorCanvas } from './EditorCanvas';

const ZONES = ZONES_CATALOG_DEFAULT;
const FLAT = makeFlat();
const ORDER = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const ASSET = { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 120, intrinsic_h_mm: 80, size_estimated: false, has_preview: false };
const ctx = (view) => ({ flat: FLAT, zonesCatalog: ZONES, category: 'tshirts', view, itemKind: 'sku', method: 'dtf' });
const placed = (view = 'front', area = view === 'front' ? 'chest' : 'back') => newPlacedPrint(ASSET, `orders/${ORDER}/logo/${view}.png`, area, ctx(view));
const T = makeTransform(DEFAULT_STAGE, { w: 600, h: 760 });

function setup(over = {}) {
  const front = placed('front');
  const props = {
    flat: FLAT,
    view: 'front',
    prints: [front, placed('back'), newSalesPrint({ zone: 'Рукав' })],
    selectedKey: null,
    readOnly: false,
    orderId: ORDER,
    onSelect: vi.fn(),
    onCommit: vi.fn(),
    onDropFile: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...over,
  };
  const utils = render(<EditorCanvas {...props} />);
  const canvas = screen.getByRole('application');
  return { ...utils, props, front, canvas };
}

function fakeNode(attrs) {
  const a = { x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1, ...attrs };
  return {
    x: () => a.x, y: () => a.y, width: () => a.width, height: () => a.height,
    rotation: () => a.rotation, scaleX: () => a.scaleX, scaleY: () => a.scaleY,
    position: vi.fn((p) => { a.x = p.x; a.y = p.y; }),
  };
}

beforeEach(() => {
  h.nodes.clear();
  h.flat = { status: 'ready', image: {}, flatMm: { w: 600, h: 760 } };
  useDesignStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('EditorCanvas — открытие', () => {
  it('область холста названа и описана; на холсте — только нанесения этого флэта и вида', async () => {
    const { canvas, front } = setup();
    expect(canvas).toHaveAccessibleName('Холст: Футболка (тест), вид перед');
    expect(canvas).toHaveAccessibleDescription(/Стрелки — сдвиг на 1 мм/);
    expect([...h.nodes.keys()]).toEqual([front.key]);
    await waitFor(() => expect(canvas).toHaveAttribute('data-ready', 'true'));
  });

  it('открытие ничего не пишет: ни правки с холста, ни записи в заказ, ни выбора', async () => {
    const edit = vi.fn();
    useSalesStore.setState({ edit });
    const { props, canvas } = setup();
    await waitFor(() => expect(canvas).toHaveAttribute('data-ready', 'true'));
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it('силуэт грузится — плашка и data-ready=false; нанесений нет — подсказка про логотип', () => {
    h.flat = { status: 'loading', image: null, flatMm: null };
    const { canvas, unmount } = setup();
    expect(screen.getByText('Загружаю силуэт…')).toBeInTheDocument();
    expect(canvas).toHaveAttribute('data-ready', 'false');
    unmount();
    h.flat = { status: 'ready', image: {}, flatMm: { w: 600, h: 760 } };
    setup({ prints: [] });
    expect(screen.getByText('Перетащите логотип сюда или нажмите «Загрузить логотип»')).toBeInTheDocument();
  });
});

describe('EditorCanvas — правка', () => {
  it('нажатие на нанесение выбирает его; щелчок по пустому стейджу снимает выбор', () => {
    const { props, front } = setup();
    h.nodes.get(front.key).onMouseDown();
    expect(props.onSelect).toHaveBeenLastCalledWith(front.key);
    const stage = {};
    stage.getStage = () => stage;
    h.stage.props.onClick({ target: stage });
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
  });

  it('конец перетаскивания → «Перемещение» с новой рамкой; центр у оси изделия притягивается', () => {
    const { props, front } = setup();
    const pl = placementOf(front, FLAT);
    // центр на 3 мм правее оси и на 40 мм ниже
    const node = fakeNode({ x: T.px(CENTER_X + 3), y: T.py(pl.y_mm + pl.height_mm / 2 + 40) });
    act(() => h.nodes.get(front.key).onDragEnd({ target: node }));
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const change = props.onCommit.mock.calls[0][0];
    expect(change).toMatchObject({ kind: 'place', key: front.key, label: 'Перемещение' });
    expect(change.geometry.x_mm + change.geometry.width_mm / 2).toBeCloseTo(CENTER_X, 6);
    expect(change.geometry.y_mm).toBeCloseTo(pl.y_mm + 40, 6);
    expect(change.geometry.width_mm).toBe(pl.width_mm);
  });

  it('конец трансформации → «Размер и поворот»: мм из масштаба узла, отражение из знака', () => {
    const { props, front } = setup();
    const pl = placementOf(front, FLAT);
    const node = fakeNode({
      x: T.px(pl.x_mm + pl.width_mm / 2), y: T.py(pl.y_mm + pl.height_mm / 2),
      width: T.s(pl.width_mm), height: T.s(pl.height_mm), rotation: 15, scaleX: -1.5, scaleY: 1.5,
    });
    act(() => h.nodes.get(front.key).onTransformEnd({ target: node }));
    const change = props.onCommit.mock.calls[0][0];
    expect(change).toMatchObject({ kind: 'place', label: 'Размер и поворот' });
    expect(change.geometry).toMatchObject({ rotation_deg: 15, flip_h: true, flip_v: false });
    expect(change.geometry.width_mm).toBeCloseTo(180, 6);
    expect(change.geometry.height_mm).toBeCloseTo(120, 6);
  });

  it('клавиши на области холста: стрелка — сдвиг, Delete — снять с изделия, Esc — снять выбор, Ctrl+Z — отмена', () => {
    const front = placed('front');
    const { props, canvas } = setup({ prints: [front], selectedKey: front.key });
    fireEvent.keyDown(canvas, { key: 'ArrowDown', shiftKey: true });
    expect(props.onCommit).toHaveBeenLastCalledWith({
      kind: 'nudge', key: front.key, dx_mm: 0, dy_mm: 10, label: 'Сдвиг', coalesceKey: `nudge:${front.key}`,
    });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(props.onCommit).toHaveBeenLastCalledWith({ kind: 'unplace', key: front.key, label: 'Снять с изделия' });
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(props.onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(canvas, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(props.onUndo).toHaveBeenCalledTimes(1);
  });

  it('клавиши на кнопках масштаба холст не трогают; кнопки меняют масштаб', () => {
    const front = placed('front');
    const { props } = setup({ prints: [front], selectedKey: front.key });
    const zoomIn = screen.getByRole('button', { name: 'Увеличить' });
    fireEvent.keyDown(zoomIn, { key: 'ArrowLeft' });
    expect(props.onCommit).not.toHaveBeenCalled();
    fireEvent.click(zoomIn);
    expect(useDesignStore.getState().zoom).toBeCloseTo(1.2, 6);
    fireEvent.click(screen.getByRole('button', { name: 'Вписать в окно' }));
    expect(useDesignStore.getState().zoom).toBe(1);
  });

  it('выбранное: обвязка с размером и пересказ для aria-live с паузой', () => {
    vi.useFakeTimers();
    const front = placed('front');
    setup({ prints: [front], selectedKey: front.key });
    expect(screen.getByText('120×80 мм')).toBeInTheDocument();
    expect(screen.queryByText(/^Нанесение 1:/)).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByText(`Нанесение 1: 120 × 80 мм, ${front.offset_mm} мм от шва горловины`)).toBeInTheDocument();
  });
});

describe('EditorCanvas — файл на холст', () => {
  const file = () => new File(['x'], 'logo.png', { type: 'image/png' });

  it('сброс файла: точка в мм и зона под ней', async () => {
    const { props, canvas } = setup();
    const f = file();
    // в jsdom нет DragEvent: точка сброса — у MouseEvent с dataTransfer, как в браузере
    const ev = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: T.px(300), clientY: T.py(300) });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [f] } });
    fireEvent(canvas, ev);
    await waitFor(() => expect(props.onDropFile).toHaveBeenCalledTimes(1));
    const [got, opts] = props.onDropFile.mock.calls[0];
    expect(got).toBe(f);
    expect(opts.areaId).toBe('chest');
    expect(opts.at.x_mm).toBeCloseTo(300, 6);
    expect(opts.at.y_mm).toBeCloseTo(300, 6);
  });

  it('точки нет (событие без координат) — файл без точки, зона по умолчанию', async () => {
    const { props, canvas } = setup();
    const f = file();
    fireEvent.drop(canvas, { dataTransfer: { types: ['Files'], files: [f] } });
    await waitFor(() => expect(props.onDropFile).toHaveBeenCalledWith(f, {}));
  });

  it('вставка Ctrl+V — файл без точки', async () => {
    const { props, canvas } = setup();
    const f = file();
    fireEvent.paste(canvas, { clipboardData: { files: [f] } });
    await waitFor(() => expect(props.onDropFile).toHaveBeenCalledWith(f, {}));
  });
});

describe('EditorCanvas — только чтение', () => {
  it('без перетаскивания, трансформера и клавиш правки; выбор и подсказка «Только просмотр»', () => {
    const front = placed('front');
    const { props, canvas, container } = setup({ prints: [front], selectedKey: front.key, readOnly: true });
    expect(h.nodes.get(front.key).draggable).toBe(false);
    expect(container.querySelector('[data-konva="Transformer"]')).toBeNull();
    expect(canvas).toHaveAccessibleDescription(/^Только просмотр/);
    fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    act(() => h.nodes.get(front.key).onDragEnd({ target: fakeNode({ x: 1, y: 1 }) }));
    expect(props.onCommit).not.toHaveBeenCalled();
    expect(props.onUndo).not.toHaveBeenCalled();
    h.nodes.get(front.key).onMouseDown();
    expect(props.onSelect).toHaveBeenCalledWith(front.key);
  });

  it('файл на холст не принимается; пустой вид — «нанесений нет»', () => {
    const { props, canvas } = setup({ readOnly: true, prints: [] });
    fireEvent.drop(canvas, { dataTransfer: { types: ['Files'], files: [new File(['x'], 'a.png')] } });
    fireEvent.paste(canvas, { clipboardData: { files: [new File(['x'], 'a.png')] } });
    expect(props.onDropFile).not.toHaveBeenCalled();
    expect(screen.getByText('На этом виде нанесений нет')).toBeInTheDocument();
  });
});

describe('EditorCanvas — «Как на изделии» (веха 5в, Э2)', () => {
  it('без разметки: нет подписи зоны и строки размера зоны; выбор работает; режим — в имени холста', () => {
    const { canvas, props, container } = setup({ display: 'garment', selectedKey: null });
    expect(canvas).toHaveAccessibleName(/, как на изделии$/);
    expect(screen.queryByText(/: \d+ × \d+ мм$/)).toBeNull();
    expect(container.querySelector('[data-konva="Transformer"]')).not.toBeNull();
    expect(props.onCommit).not.toHaveBeenCalled();
  });
  it('разметка (по умолчанию) — строка размера зоны есть', () => {
    setup();
    expect(screen.getByText(/: \d+ × \d+ мм$/)).toBeInTheDocument();
  });
});

