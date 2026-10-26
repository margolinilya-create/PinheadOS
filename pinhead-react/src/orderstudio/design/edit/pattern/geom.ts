/**
 * Геометрия контуров лекал (веха 5в, Э2б): площадь, рамка, упрощение
 * Дугласа — Пекера для замкнутого контура, сборка отрезков в цепочки.
 * Чистый модуль: без React, сети и DOM.
 */
export type Pt = [number, number];

export function area(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function bbox(pts: readonly Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const near = (a: Pt, b: Pt, eps: number) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;

/** Без повторов подряд и без последней точки, равной первой (замкнутый контур) */
export function dedupe(pts: readonly Pt[], eps = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.length || !near(out[out.length - 1], p, eps)) out.push(p);
  if (out.length > 1 && near(out[0], out[out.length - 1], eps)) out.pop();
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdp(pts: readonly Pt[], tol: number): Pt[] {
  if (pts.length < 3) return [...pts];
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), tol).slice(0, -1), ...rdp(pts.slice(idx), tol)];
}

/**
 * Упрощение замкнутого контура: разрез в самой дальней от первой точке, RDP
 * обеих половин; точек больше `maxPoints` — допуск растёт вдвое
 */
export function simplifyClosed(pts: readonly Pt[], tol: number, maxPoints: number): Pt[] {
  const src = dedupe(pts);
  if (src.length <= 3) return src;
  let far = 0;
  let max = -1;
  src.forEach((p, i) => {
    const d = Math.hypot(p[0] - src[0][0], p[1] - src[0][1]);
    if (d > max) { max = d; far = i; }
  });
  let t = tol;
  for (let guard = 0; guard < 24; guard++) {
    const a = rdp(src.slice(0, far + 1), t);
    const b = rdp([...src.slice(far), src[0]], t);
    const out = dedupe([...a.slice(0, -1), ...b.slice(0, -1)]);
    if (out.length <= maxPoints) return out;
    t *= 2;
  }
  return src.slice(0, maxPoints);
}

/** Отрезки → замкнутые контуры по совпадению концов; незамкнутое — в `open` */
export function chainSegments(segs: readonly [Pt, Pt][], eps = 0.01): { closed: Pt[][]; open: Pt[][] } {
  const left = segs.map((s) => [...s] as [Pt, Pt]);
  const closed: Pt[][] = [];
  const open: Pt[][] = [];
  while (left.length) {
    const [a, b] = left.shift()!;
    const chain: Pt[] = [a, b];
    let grew = true;
    while (grew && !near(chain[0], chain[chain.length - 1], eps)) {
      grew = false;
      const end = chain[chain.length - 1];
      const i = left.findIndex(([p, q]) => near(p, end, eps) || near(q, end, eps));
      if (i >= 0) {
        const [p, q] = left.splice(i, 1)[0];
        chain.push(near(p, end, eps) ? q : p);
        grew = true;
      }
    }
    if (chain.length > 3 && near(chain[0], chain[chain.length - 1], eps)) closed.push(dedupe(chain, eps));
    else open.push(chain);
  }
  return { closed, open };
}

/** Дуга по выпуклости DXF (`bulge` = tg(θ/4)) — промежуточные точки без концов */
export function bulgeArc(a: Pt, b: Pt, bulge: number, stepDeg = 5): Pt[] {
  if (!bulge) return [];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!chord) return [];
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const h = r * Math.cos(theta / 2);
  const nx = -(b[1] - a[1]) / chord;
  const ny = (b[0] - a[0]) / chord;
  const cx = mx + nx * h;
  const cy = my + ny * h;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  const n = Math.max(1, Math.ceil(Math.abs(theta) * 180 / Math.PI / stepDeg));
  const out: Pt[] = [];
  for (let i = 1; i < n; i++) {
    const t = a0 + (theta * i) / n;
    out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]);
  }
  return out;
}
