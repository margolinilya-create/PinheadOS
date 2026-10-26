/**
 * Разбор DXF лекал конструктора (веха 5в, Э2б) — свой разбор контуров, без
 * зависимостей. Читается то, что нужно для деталей кроя:
 * - `$INSUNITS` шапки: 1 — дюймы, 4 — мм, 5 — см, 6 — метры; нет — `null`
 *   (единицы выбирает человек);
 * - `LWPOLYLINE` (с `bulge` — дуга отрезками), `POLYLINE` + `VERTEX` … `SEQEND`,
 *   `LINE` (цепочки по совпадению концов);
 * - блоки (`BLOCK` … `ENDBLK`) и их вставки `INSERT` (точка, масштаб, поворот):
 *   AAMA/ASTM кладут деталь в блок, контур — на слое «1»; внутренние линии
 *   (насечки, долевая) — на других слоях и деталями не становятся.
 *
 * Деталь — блок (контур слоя «1», иначе наибольший замкнутый) либо замкнутый
 * контур вне блоков, не лежащий внутри другого. Ось Y файла вверх — здесь
 * переворачивается (мм вида — Y вниз).
 */
import { area, bbox, bulgeArc, chainSegments, dedupe, type Pt } from './geom';

export type DxfUnits = 'mm' | 'cm' | 'in' | 'm';

export interface RawPiece {
  name: string;
  /** В единицах файла, Y вниз */
  contour: Pt[];
}

export interface DxfResult {
  units: DxfUnits | null;
  pieces: RawPiece[];
  /** Почему что-то не стало деталью — человеку текстом */
  notes: string[];
}

const UNITS: Record<number, DxfUnits> = { 1: 'in', 4: 'mm', 5: 'cm', 6: 'm' };

interface Entity {
  type: string;
  layer: string;
  props: [number, string][];
}

interface Shape { layer: string; pts: Pt[]; closed: boolean }

function readPairs(text: string): [number, string][] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isFinite(code)) out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

const num = (v: string | undefined, d = 0) => {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : d;
};
const first = (e: Entity, code: number) => e.props.find((p) => p[0] === code)?.[1];

/** LWPOLYLINE: вершины 10/20, выпуклость 42 относится к вершине перед ней */
function lwPolyline(e: Entity): Shape {
  const verts: { p: Pt; bulge: number }[] = [];
  let x: number | null = null;
  for (const [c, v] of e.props) {
    if (c === 10) x = num(v);
    else if (c === 20 && x !== null) { verts.push({ p: [x, num(v)], bulge: 0 }); x = null; }
    else if (c === 42 && verts.length) verts[verts.length - 1].bulge = num(v);
  }
  const closed = (num(first(e, 70)) & 1) === 1;
  return { layer: e.layer, pts: withBulges(verts, closed), closed };
}

function withBulges(verts: { p: Pt; bulge: number }[], closed: boolean): Pt[] {
  const pts: Pt[] = [];
  verts.forEach((v, i) => {
    pts.push(v.p);
    const next = verts[i + 1] ?? (closed ? verts[0] : null);
    if (next && v.bulge) pts.push(...bulgeArc(v.p, next.p, v.bulge));
  });
  return pts;
}

/** Сущности по порядку → фигуры (POLYLINE собирает свои VERTEX до SEQEND) */
function shapesOf(entities: Entity[]): { shapes: Shape[]; inserts: Entity[] } {
  const shapes: Shape[] = [];
  const inserts: Entity[] = [];
  const lines: { layer: string; seg: [Pt, Pt] }[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.type === 'LWPOLYLINE') shapes.push(lwPolyline(e));
    else if (e.type === 'POLYLINE') {
      const verts: { p: Pt; bulge: number }[] = [];
      while (entities[i + 1]?.type === 'VERTEX') {
        const v = entities[++i];
        verts.push({ p: [num(first(v, 10)), num(first(v, 20))], bulge: num(first(v, 42)) });
      }
      if (entities[i + 1]?.type === 'SEQEND') i++;
      const closed = (num(first(e, 70)) & 1) === 1;
      shapes.push({ layer: e.layer, pts: withBulges(verts, closed), closed });
    } else if (e.type === 'LINE') {
      lines.push({ layer: e.layer, seg: [[num(first(e, 10)), num(first(e, 20))], [num(first(e, 11)), num(first(e, 21))]] });
    } else if (e.type === 'INSERT') inserts.push(e);
  }
  const byLayer = new Map<string, [Pt, Pt][]>();
  for (const l of lines) byLayer.set(l.layer, [...(byLayer.get(l.layer) ?? []), l.seg]);
  for (const [layer, segs] of byLayer) {
    const { closed, open } = chainSegments(segs);
    closed.forEach((pts) => shapes.push({ layer, pts, closed: true }));
    open.filter((pts) => pts.length > 2).forEach((pts) => shapes.push({ layer, pts, closed: false }));
  }
  // Полилиния, у которой первая и последняя точки совпали, — замкнута
  return {
    shapes: shapes.map((s) => {
      const d = dedupe(s.pts, 1e-6);
      const closedByPoints = !s.closed && d.length < s.pts.length && s.pts.length > 3;
      return { ...s, pts: d, closed: s.closed || closedByPoints };
    }),
    inserts,
  };
}

/** Контур детали из фигур блока: слой «1» (AAMA), иначе наибольший замкнутый */
function boundaryOf(shapes: Shape[]): Pt[] | null {
  const closed = shapes.filter((s) => s.closed && s.pts.length >= 3);
  const pool = closed.some((s) => s.layer === '1') ? closed.filter((s) => s.layer === '1') : closed;
  if (!pool.length) return null;
  return pool.reduce((a, b) => (area(b.pts) > area(a.pts) ? b : a)).pts;
}

function transform(pts: Pt[], ins: Entity): Pt[] {
  const ox = num(first(ins, 10));
  const oy = num(first(ins, 20));
  const sx = num(first(ins, 41), 1);
  const sy = num(first(ins, 42), 1);
  const r = (num(first(ins, 50)) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return pts.map(([x, y]) => [ox + (x * sx) * c - (y * sy) * s, oy + (x * sx) * s + (y * sy) * c]);
}

const flipY = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x, -y]);

const inside = (a: Pt[], b: Pt[]) => {
  const A = bbox(a);
  const B = bbox(b);
  return A.x >= B.x && A.y >= B.y && A.x + A.w <= B.x + B.w && A.y + A.h <= B.y + B.h && area(a) < area(b);
};

export function parseDxf(text: string): DxfResult {
  const pairs = readPairs(text);
  let units: DxfUnits | null = null;
  const blocks = new Map<string, Entity[]>();
  const top: Entity[] = [];
  let section = '';
  let block: { name: string; ents: Entity[] } | null = null;
  let cur: Entity | null = null;
  let headerVar = '';
  const flush = () => {
    if (!cur) return;
    if (block) block.ents.push(cur);
    else if (section === 'ENTITIES') top.push(cur);
    cur = null;
  };
  for (let i = 0; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === 0) {
      flush();
      if (value === 'SECTION') { section = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1] : ''; continue; }
      if (value === 'ENDSEC') { section = ''; continue; }
      if (section === 'BLOCKS' && value === 'BLOCK') { block = { name: '', ents: [] }; continue; }
      if (section === 'BLOCKS' && value === 'ENDBLK') {
        if (block?.name) blocks.set(block.name, block.ents);
        block = null;
        continue;
      }
      if (section === 'ENTITIES' || (section === 'BLOCKS' && block)) cur = { type: value, layer: '', props: [] };
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) headerVar = value;
      else if (headerVar === '$INSUNITS' && code === 70) units = UNITS[Number.parseInt(value, 10)] ?? null;
      continue;
    }
    if (block && !cur && code === 2 && !block.name) { block.name = value; continue; }
    if (cur) {
      if (code === 8) cur.layer = value;
      cur.props.push([code, value]);
    }
  }
  flush();

  const notes: string[] = [];
  const pieces: RawPiece[] = [];
  const { shapes, inserts } = shapesOf(top);
  inserts.forEach((ins, k) => {
    const name = first(ins, 2) ?? '';
    const ents = blocks.get(name);
    if (!ents) return;
    const b = boundaryOf(shapesOf(ents).shapes);
    if (b) pieces.push({ name: name || `Деталь ${k + 1}`, contour: flipY(transform(b, ins)) });
    else notes.push(`Блок «${name}»: нет замкнутого контура — деталь не взята`);
  });
  const closed = shapes.filter((s) => s.closed && s.pts.length >= 3).map((s) => s.pts);
  closed.filter((c) => !closed.some((o) => o !== c && inside(c, o)))
    .forEach((c) => pieces.push({ name: `Деталь ${pieces.length + 1}`, contour: flipY(c) }));
  const open = shapes.filter((s) => !s.closed).length;
  if (open) notes.push(`Незамкнутых контуров: ${open} — деталями не стали (проверьте файл в программе конструктора)`);
  return { units, pieces, notes };
}
