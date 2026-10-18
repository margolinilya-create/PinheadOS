import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { area, frontView } from '../../../design/fixtures.testutil';
import { sleeveView } from '../../../design/fixtures5b.testutil';
import { fit, toPx } from './canvasMath';
import { DEFAULT_STAGE } from './useStageSize';

/**
 * Холст редактора флэта в jsdom: konva подменён простыми div (konva — в e2e,
 * задача 7). Узлы с `name` пишут свои пропсы в `h.nodes` — тест зовёт их
 * обработчики так, как это сделала бы konva.
 */
const h = vi.hoisted(() => ({ nodes: new Map(), stage: { props: null }, tr: { props: null } }));

vi.mock('../../../design/ui/konva', () => {
  const box = (kind) => function KonvaBox({ children, ...props }) {
    if (props.name) h.nodes.set(props.name, props);
    return <div data-konva={kind} data-name={props.name ?? ''}>{children}</div>;
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
    Image: box('Image'),
    Text: function Text({ text }) {
      return <span data-konva="Text">{text}</span>;
    },
    Transformer: function Transformer(props) {
      h.tr.props = props;
      return <div data-konva="Transformer" />;
    },
  };
});

import { FlatCanvas } from './FlatCanvas';

const FM = { w: 600, h: 760 };
const F = fit(DEFAULT_STAGE, FM);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><g id="garment" fill="#000000"><rect width="600" height="760"/></g></svg>';
const POCKET = area({ id: 'pocket', name: 'Карман', zone_id: 'pocket', polygon_mm: [[320, 300], [420, 300], [420, 400], [320, 400]], safe_inset_mm: 5 });
const YOKE = area({ id: 'yoke', name: 'Кокетка', zone_id: 'back', polygon_mm: [[200, 60], [400, 60], [380, 120], [220, 120]], safe_inset_mm: 0 });
const VIEW = frontView({ print_areas: [area(), POCKET] });

class FakeImage {
  onload = null;
  onerror = null;
  set src(_) {
    setTimeout(() => this.onload?.(), 0);
  }
}

/** Узел konva: позиция и размеры, как их вернула бы konva после жеста */
const fakeNode = (attrs) => {
  const n = { ...attrs, scaleX: attrs.scaleX ?? 1, scaleY: attrs.scaleY ?? 1, set: [] };
  return {
    x: () => n.x, y: () => n.y, width: () => n.width, height: () => n.height, scaleX: () => n.scaleX, scaleY: () => n.scaleY,
    position: (p) => n.set.push(p),
    setAttrs: (a) => n.set.push(a),
    raw: n,
  };
};

/** Обёртка с выбором зоны в состоянии — как у редактора (задача 6б) */
function Harness({ initial = null, onSelectSpy, ...props }) {
  const [sel, setSel] = useState(initial);
  return (
    <FlatCanvas
      markup={SVG}
      flatMm={FM}
      view={VIEW}
      label="Холст флэта: Футболка, вид Перед"
      selectedAreaId={sel}
      onSelectArea={(id) => { onSelectSpy?.(id); setSel(id); }}
      onAreaRect={vi.fn()}
      onAreaPoint={vi.fn()}
      onAnchors={vi.fn()}
      onMeasured={vi.fn()}
      {...props}
    />
  );
}

const canvas = () => screen.getByRole('application');

beforeEach(() => {
  h.nodes.clear();
  h.stage.props = null;
  h.tr.props = null;
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/flat');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FlatCanvas — клавиатура', () => {
  it('стрелки сдвигают выбранную зону на 1 мм, с Shift — на 10 мм', () => {
    const onAreaRect = vi.fn();
    render(<Harness initial="chest" onAreaRect={onAreaRect} />);
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    fireEvent.keyDown(canvas(), { key: 'ArrowDown', shiftKey: true });
    expect(onAreaRect.mock.calls).toEqual([
      ['chest', { x: 151, y: 140, w: 300, h: 400 }],
      ['chest', { x: 150, y: 150, w: 300, h: 400 }],
    ]);
  });

  it('] выбирает следующую зону и озвучивает её имя; фокус остаётся на холсте', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<Harness initial="chest" onSelectSpy={spy} />);
    canvas().focus();
    fireEvent.keyDown(canvas(), { key: ']' });
    expect(spy).toHaveBeenCalledWith('pocket');
    expect(document.activeElement).toBe(canvas());
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText(/^Зона «Карман»: X 320, Y 300, 100 × 100 мм$/)).toHaveAttribute('aria-live', 'polite');
    fireEvent.keyDown(canvas(), { key: 'PageUp' });
    expect(spy).toHaveBeenLastCalledWith('chest');
  });

  it('озвучка после стрелки — с паузой ~500 мс', () => {
    vi.useFakeTimers();
    function Moving() {
      const [view, setView] = useState(VIEW);
      return (
        <Harness
          initial="chest"
          view={view}
          onAreaRect={(id, r) => setView((v) => ({ ...v, print_areas: v.print_areas.map((a) => (a.id === id ? { ...a, polygon_mm: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]] } : a)) }))}
        />
      );
    }
    render(<Moving />);
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.keyDown(canvas(), { key: 'ArrowRight', shiftKey: true });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText(/X 160/)).toBeNull();
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByText('Зона «Грудь»: X 160, Y 140, 300 × 400 мм')).toBeInTheDocument();
  });

  it('Esc снимает выбор; Tab не перехватывается', () => {
    const spy = vi.fn();
    render(<Harness initial="chest" onSelectSpy={spy} />);
    const tab = fireEvent.keyDown(canvas(), { key: 'Tab' });
    expect(tab).toBe(true);
    fireEvent.keyDown(canvas(), { key: 'Escape' });
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('многоугольник в режиме «Выбор» стрелками не двигается (молча в прямоугольник не превращается)', () => {
    const onAreaRect = vi.fn();
    render(<Harness initial="yoke" view={frontView({ print_areas: [YOKE] })} onAreaRect={onAreaRect} />);
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    expect(onAreaRect).not.toHaveBeenCalled();
    expect(h.nodes.get('area:yoke').draggable).toBeUndefined();
  });
});

describe('FlatCanvas — ручки и зоны', () => {
  it('ось изделия не двигается по Y (dragBoundFunc), итог — только center_axis_x', () => {
    const onAnchors = vi.fn();
    render(<Harness onAnchors={onAnchors} />);
    const axis = h.nodes.get('anchor:axis');
    const at = toPx(F, { x: 300, y: 52 });
    expect(axis.dragBoundFunc({ x: 999, y: 999 })).toEqual({ x: 999, y: at.y });
    axis.onDragEnd({ target: fakeNode({ x: toPx(F, { x: 320, y: 0 }).x, y: at.y }) });
    expect(onAnchors).toHaveBeenCalledWith({ center_axis_x: 320 });
  });

  it('горловина — X и Y; низ рукава — только Y, центр рукава — только X', () => {
    const onAnchors = vi.fn();
    const { unmount } = render(<Harness onAnchors={onAnchors} />);
    expect(h.nodes.get('anchor:neckline').dragBoundFunc({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    unmount();
    h.nodes.clear();
    render(<Harness view={sleeveView('sleeve_left', 'flats/x/v1/sleeve_left.svg')} onAnchors={onAnchors} />);
    const bottom = h.nodes.get('anchor:sleeve_bottom');
    expect(bottom.dragBoundFunc({ x: 5, y: 7 }).x).toBe(toPx(F, { x: 150, y: 0 }).x);
    expect(h.nodes.get('anchor:sleeve_center').dragBoundFunc({ x: 5, y: 7 }).x).toBe(5);
    bottom.onDragEnd({ target: fakeNode({ x: 0, y: toPx(F, { x: 0, y: 510 }).y }) });
    expect(onAnchors).toHaveBeenLastCalledWith({ sleeve_bottom_y: 510 });
  });

  it('аксессуар — без горловины', () => {
    render(<Harness accessory />);
    expect(h.nodes.has('anchor:axis')).toBe(true);
    expect(h.nodes.has('anchor:neckline')).toBe(false);
  });

  it('перетаскивание рамки: размер прежний, узел возвращается на место из пропсов', () => {
    const onAreaRect = vi.fn();
    render(<Harness initial="chest" onAreaRect={onAreaRect} />);
    const n = fakeNode({ x: toPx(F, { x: 160, y: 0 }).x, y: toPx(F, { x: 0, y: 150 }).y, width: 300 * F.pxPerMm, height: 400 * F.pxPerMm });
    h.nodes.get('area:chest').onDragEnd({ target: n });
    expect(onAreaRect).toHaveBeenCalledWith('chest', { x: 160, y: 150, w: 300, h: 400 });
    expect(n.raw.set[0]).toMatchObject({ x: toPx(F, { x: 150, y: 140 }).x, y: toPx(F, { x: 150, y: 140 }).y });
  });

  it('трансформация: масштаб узла — в размер зоны, затем сбрасывается в 1', () => {
    const onAreaRect = vi.fn();
    render(<Harness initial="chest" onAreaRect={onAreaRect} />);
    const p = toPx(F, { x: 150, y: 140 });
    const n = fakeNode({ x: p.x, y: p.y, width: 300 * F.pxPerMm, height: 400 * F.pxPerMm, scaleX: 0.5, scaleY: 1.25 });
    h.nodes.get('area:chest').onTransformEnd({ target: n });
    expect(onAreaRect).toHaveBeenCalledWith('chest', { x: 150, y: 140, w: 150, h: 500 });
    expect(n.raw.set[0]).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(h.tr.props).toMatchObject({ rotateEnabled: false, keepRatio: false });
  });

  it('пальцем: ручки трансформера ≥ 20 px и область попадания 44 px', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener: () => {}, removeEventListener: () => {} }));
    render(<Harness initial="chest" />);
    expect(h.tr.props.anchorSize).toBeGreaterThanOrEqual(20);
    const anchor = { hitStrokeWidth: vi.fn() };
    h.tr.props.anchorStyleFunc(anchor);
    expect(h.tr.props.anchorSize + anchor.hitStrokeWidth.mock.calls[0][0]).toBeGreaterThanOrEqual(44);
  });

  it('режим «Точки»: ручки вершин выбранной зоны; перетаскивание и стрелки → onAreaPoint', () => {
    const onAreaPoint = vi.fn();
    render(<Harness initial="pocket" mode="points" onAreaPoint={onAreaPoint} />);
    expect(h.tr.props).toBeNull();
    const v2 = h.nodes.get('vertex:pocket:2');
    v2.onDragEnd({ target: fakeNode({ x: toPx(F, { x: 430, y: 0 }).x, y: toPx(F, { x: 0, y: 410 }).y }) });
    expect(onAreaPoint).toHaveBeenLastCalledWith('pocket', 2, [430, 410]);
    act(() => v2.onMouseDown());
    fireEvent.keyDown(canvas(), { key: 'ArrowLeft', shiftKey: true });
    expect(onAreaPoint).toHaveBeenLastCalledWith('pocket', 2, [410, 400]);
  });
});

describe('FlatCanvas — калибровка, просмотр, готовность', () => {
  it('калибровка: два клика → onMeasured(мм); Esc — сброс отмера', () => {
    const onMeasured = vi.fn();
    render(<Harness mode="calibrate" onMeasured={onMeasured} />);
    const click = (mm) => {
      const stage = { getPointerPosition: () => toPx(F, mm) };
      act(() => h.stage.props.onClick({ target: { getStage: () => stage } }));
    };
    click({ x: 100, y: 100 });
    click({ x: 400, y: 500 });
    expect(onMeasured).toHaveBeenCalledTimes(1);
    expect(onMeasured.mock.calls[0][0]).toBeCloseTo(500, 6);
    expect(h.nodes.has('anchor:axis')).toBe(false);
    expect(canvas()).toHaveAttribute('data-mode', 'calibrate');
  });

  it('readOnly: без ручек и трансформера, у зон нет обработчиков правки', () => {
    const onAreaRect = vi.fn();
    render(<Harness initial="chest" readOnly onAreaRect={onAreaRect} />);
    expect(h.tr.props).toBeNull();
    expect([...h.nodes.keys()].filter((k) => k.startsWith('anchor:'))).toEqual([]);
    const chest = h.nodes.get('area:chest');
    expect(chest.draggable).toBe(false);
    expect(chest.onDragEnd).toBeUndefined();
    expect(chest.onTransformEnd).toBeUndefined();
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    expect(onAreaRect).not.toHaveBeenCalled();
    expect(screen.getByText(/^Только просмотр/)).toBeInTheDocument();
  });

  it('data-ready появляется после декодирования SVG', async () => {
    render(<Harness />);
    expect(canvas()).toHaveAttribute('data-ready', 'false');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-ready', 'true'));
    expect(canvas()).toHaveAttribute('aria-label', 'Холст флэта: Футболка, вид Перед');
    expect(canvas().getAttribute('data-scene')).toMatch(/^mode=select\narea chest «Грудь» rect 150,140 300×400/);
  });

  it('без файла силуэта — готов сразу, с подсказкой', () => {
    render(<Harness markup={null} />);
    expect(canvas()).toHaveAttribute('data-ready', 'true');
    expect(screen.getByText('Файла силуэта у вида нет — загрузите SVG')).toBeInTheDocument();
  });

  it('клик мимо зон снимает выбор; клик по зоне — выбирает', () => {
    const spy = vi.fn();
    render(<Harness initial="chest" onSelectSpy={spy} />);
    act(() => h.nodes.get('area:pocket').onClick());
    expect(spy).toHaveBeenLastCalledWith('pocket');
    const stage = { getPointerPosition: () => ({ x: 0, y: 0 }) };
    stage.getStage = () => stage;
    act(() => h.stage.props.onClick({ target: stage }));
    expect(spy).toHaveBeenLastCalledWith(null);
  });
});
