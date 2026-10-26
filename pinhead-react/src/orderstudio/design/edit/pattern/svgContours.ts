/**
 * Разбор SVG лекал конструктора (веха 5в, Э2б): замкнутые контуры деталей
 * в единицах пользователя SVG и множитель «единица → мм», если он известен
 * из `width`/`height` с единицами и `viewBox`.
 *
 * Читается `path` (M L H V C S Q T A Z, абсолютные и относительные; кривые и дуги —
 * отрезками), `polygon`, `polyline`, `rect`, `circle`, `ellipse`; `transform`
 * элемента и всех предков. `defs`, `clipPath`, `mask`, `symbol`, `pattern` —
 * пропускаются. Разметка в DOM не вставляется — только чтение геометрии
 * (`DOMParser`, скрипты при разборе не исполняются).
 */
import { area, bbox, dedupe, type Pt } from './geom';
import type { RawPiece } from './dxf';

export interface SvgContours {
  pieces: RawPiece[];
  /** Мм на единицу пользователя; `null` — единицы не указаны, их выбирает человек */
  unitMm: number | null;
  notes: string[];
}

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m: M, [x, y]: Pt): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(s: string | null): M {
  let m: M = ID;
  if (!s) return m;
  for (const [, fn, args] of s.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    let t: M = ID;
    if (fn === 'matrix' && a.length === 6) t = a as M;
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') t = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      t = mul(mul([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, t);
  }
  return m;
}

const CURVE_STEPS = 12;

/** Дуга SVG (параметры конца) → точки без начальной (SVG 1.1, F.6.5) */
function arcPoints(p0: Pt, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, p1: Pt): Pt[] {
  if (!rx || !ry) return [p1];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let rX = Math.abs(rx);
  let rY = Math.abs(ry);
  const lambda = (x1 * x1) / (rX * rX) + (y1 * y1) / (rY * rY);
  if (lambda > 1) { rX *= Math.sqrt(lambda); rY *= Math.sqrt(lambda); }
  const num = rX * rX * rY * rY - rX * rX * y1 * y1 - rY * rY * x1 * x1;
  const den = rX * rX * y1 * y1 + rY * rY * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rX * y1) / rY;
  const cy1 = (-k * rY * x1) / rX;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rX, (y1 - cy1) / rY);
  let dt = ang((x1 - cx1) / rX, (y1 - cy1) / rY, (-x1 - cx1) / rX, (-y1 - cy1) / rY);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(2, Math.ceil((Math.abs(dt) * 180) / Math.PI / 10));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    const x = rX * Math.cos(t);
    const y = rY * Math.sin(t);
    out.push([cos * x - sin * y + cx, sin * x + cos * y + cy]);
  }
  return out;
}

const bez = (p: Pt[], t: number): Pt => {
  const s = 1 - t;
  if (p.length === 3) return [s * s * p[0][0] + 2 * s * t * p[1][0] + t * t * p[2][0], s * s * p[0][1] + 2 * s * t * p[1][1] + t * t * p[2][1]];
  return [
    s * s * s * p[0][0] + 3 * s * s * t * p[1][0] + 3 * s * t * t * p[2][0] + t * t * t * p[3][0],
    s * s * s * p[0][1] + 3 * s * s * t * p[1][1] + 3 * s * t * t * p[2][1] + t * t * t * p[3][1],
  ];
};
const curve = (ctrl: Pt[]): Pt[] => Array.from({ length: CURVE_STEPS }, (_, i) => bez(ctrl, (i + 1) / CURVE_STEPS));

/** Путь `d` → подпути (точки и замкнутость) */
export function pathSubpaths(d: string): { pts: Pt[]; closed: boolean }[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: { pts: Pt[]; closed: boolean }[] = [];
  let cur: Pt[] = [];
  let pos: Pt = [0, 0];
  let start: Pt = [0, 0];
  let prevCtrl: Pt | null = null;
  let prevCmd = '';
  let i = 0;
  let cmd = '';
  const n = () => Number(tokens[i++]);
  const flushOpen = () => { if (cur.length > 1) out.push({ pts: cur, closed: false }); cur = []; };
  while (i < tokens.length) {
    if (/[a-z]/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const at = (x: number, y: number): Pt => (rel ? [pos[0] + x, pos[1] + y] : [x, y]);
    if (C === 'Z') {
      if (cur.length > 2) out.push({ pts: cur, closed: true });
      cur = [];
      pos = start;
      prevCtrl = null;
      prevCmd = 'Z';
      cmd = '';
      continue;
    }
    if (C === 'M') {
      flushOpen();
      pos = at(n(), n());
      start = pos;
      cur = [pos];
      cmd = rel ? 'l' : 'L';
      prevCtrl = null;
      prevCmd = 'M';
      continue;
    }
    if (!cur.length) cur = [pos];
    if (C === 'L') { pos = at(n(), n()); cur.push(pos); prevCtrl = null; }
    else if (C === 'H') { const x = n(); pos = [rel ? pos[0] + x : x, pos[1]]; cur.push(pos); prevCtrl = null; }
    else if (C === 'V') { const y = n(); pos = [pos[0], rel ? pos[1] + y : y]; cur.push(pos); prevCtrl = null; }
    else if (C === 'C' || C === 'S') {
      const c1: Pt = C === 'C' ? at(n(), n()) : (prevCtrl && /[CS]/.test(prevCmd) ? [2 * pos[0] - prevCtrl[0], 2 * pos[1] - prevCtrl[1]] : pos);
      const c2 = at(n(), n());
      const p = at(n(), n());
      cur.push(...curve([pos, c1, c2, p]));
      prevCtrl = c2;
      pos = p;
    } else if (C === 'Q' || C === 'T') {
      const c: Pt = C === 'Q' ? at(n(), n()) : (prevCtrl && /[QT]/.test(prevCmd) ? [2 * pos[0] - prevCtrl[0], 2 * pos[1] - prevCtrl[1]] : pos);
      const p = at(n(), n());
      cur.push(...curve([pos, c, p]));
      prevCtrl = c;
      pos = p;
    } else if (C === 'A') {
      const rx = n(); const ry = n(); const phi = n(); const large = n() === 1; const sweep = n() === 1;
      const p = at(n(), n());
      cur.push(...arcPoints(pos, rx, ry, phi, large, sweep, p));
      pos = p;
      prevCtrl = null;
    } else { i++; continue; }
    prevCmd = C;
    if (tokens.length && i >= tokens.length) break;
  }
  flushOpen();
  return out;
}

const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'metadata', 'title', 'desc']);
const nums = (s: string | null) => (s?.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const attr = (el: Element, a: string, d = 0) => {
  const v = Number.parseFloat(el.getAttribute(a) ?? '');
  return Number.isFinite(v) ? v : d;
};

function shapes(el: Element): { pts: Pt[]; closed: boolean }[] {
  const tag = el.localName;
  if (tag === 'path') return pathSubpaths(el.getAttribute('d') ?? '');
  if (tag === 'polygon' || tag === 'polyline') {
    const v = nums(el.getAttribute('points'));
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]);
    const loop = tag === 'polygon' || (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]);
    return [{ pts, closed: loop }];
  }
  if (tag === 'rect') {
    const [x, y, w, h] = [attr(el, 'x'), attr(el, 'y'), attr(el, 'width'), attr(el, 'height')];
    return w > 0 && h > 0 ? [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }] : [];
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = attr(el, 'cx');
    const cy = attr(el, 'cy');
    const rx = tag === 'circle' ? attr(el, 'r') : attr(el, 'rx');
    const ry = tag === 'circle' ? rx : attr(el, 'ry');
    if (!(rx > 0) || !(ry > 0)) return [];
    return [{ pts: Array.from({ length: 48 }, (_, k) => [cx + rx * Math.cos((k / 48) * 2 * Math.PI), cy + ry * Math.sin((k / 48) * 2 * Math.PI)] as Pt), closed: true }];
  }
  return [];
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96 };

/** Мм на единицу пользователя: `width` с единицами и `viewBox`; без единиц — `null` */
function unitMmOf(root: Element): number | null {
  const m = /^\s*(-?[\d.]+)\s*(mm|cm|in|pt|pc|px)\s*$/i.exec(root.getAttribute('width') ?? '');
  if (!m) return null;
  const widthMm = Number(m[1]) * UNIT_MM[m[2].toLowerCase()];
  const vb = nums(root.getAttribute('viewBox'));
  const vbW = vb.length === 4 && vb[2] > 0 ? vb[2] : Number(m[1]);
  return widthMm > 0 && vbW > 0 ? widthMm / vbW : null;
}

const inside = (a: Pt[], b: Pt[]) => {
  const A = bbox(a);
  const B = bbox(b);
  return A.x >= B.x && A.y >= B.y && A.x + A.w <= B.x + B.w && A.y + A.h <= B.y + B.h && area(a) < area(b);
};

export function parseSvgContours(text: string): SvgContours {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    return { pieces: [], unitMm: null, notes: ['Файл не читается как SVG'] };
  }
  const found: { name: string; pts: Pt[] }[] = [];
  let open = 0;
  const walk = (el: Element, m: M) => {
    if (SKIP.has(el.localName)) return;
    const mm = el === root ? m : mul(m, parseTransform(el.getAttribute('transform')));
    for (const s of shapes(el)) {
      const pts = dedupe(s.pts.map((p) => apply(mm, p)));
      if (s.closed && pts.length >= 3) found.push({ name: el.getAttribute('id') || '', pts });
      else if (pts.length > 1) open++;
    }
    for (const c of Array.from(el.children)) walk(c, mm);
  };
  walk(root, ID);
  const outer = found.filter((c) => !found.some((o) => o !== c && inside(c.pts, o.pts)));
  const notes = open ? [`Незамкнутых контуров: ${open} — деталями не стали`] : [];
  return {
    pieces: outer.map((c, k) => ({ name: c.name || `Деталь ${k + 1}`, contour: c.pts })),
    unitMm: unitMmOf(root),
    notes,
  };
}
