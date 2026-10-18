/**
 * Сцена холста редактора флэта (веха 5б, задача 6а) — что рисуется, в мм,
 * без konva: зоны (рамка или многоугольник, safe-отступ, выбор), ручки якорей
 * (место, ось перетаскивания, подпись) и режим. Холст рисует ровно эту сцену,
 * а `sceneText` даёт её детерминированную строку (как `buildPreviewSvg` 5а):
 * её проверяют юнит-тесты и e2e (`data-scene` у холста), визуальный эталон
 * холст маскирует (задача 7).
 *
 * Тексты для вспомогательных технологий — тоже здесь: имя холста, подсказка
 * клавиш (`aria-describedby`) и пересказ выбранной зоны для `aria-live`.
 */
import type { FlatView, PrintArea, ViewAnchors } from '../../../design/types';
import { areaRect, isRectArea, type Rect } from '../../../design/edit/flatEdit';
import type { FlatMm, HandleAxis } from './canvasMath';

export type CanvasMode = 'select' | 'calibrate' | 'points';

export type AnchorId = 'axis' | 'neckline' | 'sleeve_bottom' | 'sleeve_center';

export interface SceneArea {
  id: string;
  name: string;
  /** Прямоугольник по осям — рамка с трансформером; иначе — многоугольник как есть (К12) */
  rect: boolean;
  /** Описывающая рамка, мм */
  box: Rect;
  points: [number, number][];
  /** Safe-зона: рамка, сжатая на отступ; не помещается — `null` */
  safe: Rect | null;
  selected: boolean;
}

export interface SceneHandle {
  id: AnchorId;
  label: string;
  x: number;
  y: number;
  /** По какой оси тянется ручка */
  axis: HandleAxis;
}

/** Направляющая якоря (пунктир на всю высоту или ширину флэта) */
export interface SceneGuide {
  id: string;
  orient: 'v' | 'h';
  /** X вертикали или Y горизонтали, мм */
  at: number;
}

export interface Scene {
  mode: CanvasMode;
  readOnly: boolean;
  areas: SceneArea[];
  handles: SceneHandle[];
  guides: SceneGuide[];
}

export interface SceneInput {
  view: FlatView;
  flatMm: FlatMm;
  accessory: boolean;
  selectedAreaId: string | null;
  readOnly: boolean;
  mode: CanvasMode;
}

export const HANDLE_LABELS: Record<AnchorId, string> = {
  axis: 'ось',
  neckline: 'горловина',
  sleeve_bottom: 'низ рукава',
  sleeve_center: 'центр рукава',
};

/** Патч якорей по месту ручки, мм */
export function anchorPatch(id: AnchorId, [x, y]: [number, number]): Partial<ViewAnchors> {
  switch (id) {
    case 'axis': return { center_axis_x: x };
    case 'sleeve_center': return { sleeve_center_x: x };
    case 'sleeve_bottom': return { sleeve_bottom_y: y };
    default: return { neckline_point: { x, y } };
  }
}

const tenth = (v: number) => Math.round(v * 10) / 10;
const isSleeve = (view: FlatView) => view.kind === 'sleeve_left' || view.kind === 'sleeve_right';

function sceneArea(a: PrintArea, selected: boolean): SceneArea {
  const box = areaRect(a);
  const inset = a.safe_inset_mm;
  const safe = inset > 0 && box.w > 2 * inset && box.h > 2 * inset
    ? { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset }
    : null;
  return { id: a.id, name: a.name, rect: isRectArea(a), box, points: a.polygon_mm, safe, selected };
}

/** Ручки якорей вида; нет значения — ручка на месте по умолчанию (перетаскивание его задаст) */
function sceneHandles(a: ViewAnchors, view: FlatView, fm: FlatMm, accessory: boolean): SceneHandle[] {
  if (isSleeve(view)) {
    const cx = a.sleeve_center_x ?? tenth(fm.w / 2);
    const by = a.sleeve_bottom_y ?? tenth(fm.h * 0.92);
    return [
      { id: 'sleeve_bottom', label: HANDLE_LABELS.sleeve_bottom, x: cx, y: by, axis: 'y' },
      { id: 'sleeve_center', label: HANDLE_LABELS.sleeve_center, x: cx, y: tenth(fm.h * 0.08), axis: 'x' },
    ];
  }
  const ax = a.center_axis_x ?? tenth(fm.w / 2);
  const neck = a.neckline_point ?? { x: ax, y: tenth(fm.h * 0.12) };
  const out: SceneHandle[] = [
    { id: 'axis', label: HANDLE_LABELS.axis, x: ax, y: tenth(Math.max(10, neck.y - 40)), axis: 'x' },
  ];
  if (!accessory) out.push({ id: 'neckline', label: HANDLE_LABELS.neckline, x: neck.x, y: neck.y, axis: 'xy' });
  return out;
}

function sceneGuides(a: ViewAnchors, handles: SceneHandle[]): SceneGuide[] {
  const out: SceneGuide[] = [];
  for (const h of handles) {
    if (h.id === 'axis' || h.id === 'sleeve_center') out.push({ id: h.id, orient: 'v', at: h.x });
    if (h.id === 'sleeve_bottom') out.push({ id: h.id, orient: 'h', at: h.y });
  }
  for (const ax of a.axes ?? []) out.push({ id: `axes:${ax.id}`, orient: 'v', at: ax.x });
  return out;
}

/** Сцена вида. Ручки — только при правке в режиме «Выбор» или «Точки»; направляющие якорей видны всегда */
export function buildScene(p: SceneInput): Scene {
  const all = sceneHandles(p.view.anchors, p.view, p.flatMm, p.accessory);
  return {
    mode: p.mode,
    readOnly: p.readOnly,
    areas: p.view.print_areas.map((a) => sceneArea(a, a.id === p.selectedAreaId)),
    handles: p.readOnly || p.mode === 'calibrate' ? [] : all,
    guides: sceneGuides(p.view.anchors, all),
  };
}

const n = (v: number) => String(tenth(v));
const box = (r: Rect) => `${n(r.x)},${n(r.y)} ${n(r.w)}×${n(r.h)}`;

/** Детерминированная строка сцены: одна строка на объект, числа в мм с шагом 0,1 */
export function sceneText(s: Scene): string {
  const lines = [`mode=${s.mode}${s.readOnly ? ' readonly' : ''}`];
  for (const a of s.areas) {
    const shape = a.rect ? `rect ${box(a.box)}` : `poly ${a.points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}`;
    lines.push(`area ${a.id} «${a.name}» ${shape}${a.safe ? ` safe ${box(a.safe)}` : ''}${a.selected ? ' [selected]' : ''}`);
  }
  for (const h of s.handles) lines.push(`handle ${h.id} ${n(h.x)},${n(h.y)} axis=${h.axis}`);
  for (const g of s.guides) lines.push(`guide ${g.id} ${g.orient}=${n(g.at)}`);
  return lines.join('\n');
}

// ── Тексты для вспомогательных технологий ────────────────────────────────

/** Пауза пересказа для aria-live — как у холста 5а: серия стрелок не тараторит */
export const ANNOUNCE_DELAY_MS = 500;

export const CANVAS_HINT = 'Стрелки — сдвиг выбранной зоны на 1 мм, с Shift — на 10 мм. '
  + '[ и ] — соседняя зона. Esc — снять выбор. Размер и якоря — в полях справа';
export const CANVAS_HINT_READONLY = 'Только просмотр. [ и ] — соседняя зона, Esc — снять выбор';

/** Пересказ зоны: «Зона «Грудь»: X 120, Y 80, 250 × 300 мм» */
export function announceArea(a: Pick<SceneArea, 'name' | 'box' | 'rect'>): string {
  const r = a.box;
  const shape = a.rect ? '' : ', многоугольник — точки правятся в режиме «Точки» или полями справа';
  return `Зона «${a.name}»: X ${Math.round(r.x)}, Y ${Math.round(r.y)}, ${Math.round(r.w)} × ${Math.round(r.h)} мм${shape}`;
}

/** Пересказ отмера калибровки */
export function announceMeasured(mm: number): string {
  return `Отмерено ${tenth(mm)} мм — введите настоящую длину в поле справа`;
}
