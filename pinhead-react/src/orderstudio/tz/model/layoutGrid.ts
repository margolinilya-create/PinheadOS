/**
 * Таблицы ТЗ: сетка ЦВ/РАЗМ и матрица «зона × техника» (веха 6+7, задача 2).
 *
 * Сетка больше `perPage` строк (4 на странице полотна, 3 на странице нанесения —
 * как в образцах) продолжается на следующей странице с повтором шапки (К11);
 * строка итога — в конце таблицы.
 */
import { CONTENT_W, MARGIN, add, ensure, newPage, textIn, type Pager } from './layoutPager';
import { TZ_COLUMNS } from './tzColumns';
import type { TzGrid, TzMatrixRow } from './tzDocTypes';

export const GRID_ROW_H = 6;
const COLOR_W = 32;
const TOTAL_W = 16;

function gridHead(p: Pager, grid: TzGrid, cw: number, field: string): void {
  textIn(p, { x: MARGIN, y: p.y, w: COLOR_W, h: GRID_ROW_H }, 'ЦВ/РАЗМ', { kind: 'cell', bold: true, max: 9, field });
  grid.sizes.forEach((s, i) => {
    textIn(p, { x: MARGIN + COLOR_W + i * cw, y: p.y, w: cw, h: GRID_ROW_H }, s, { kind: 'cell', bold: true, max: 9, field });
  });
  textIn(p, { x: MARGIN + COLOR_W + grid.sizes.length * cw, y: p.y, w: TOTAL_W, h: GRID_ROW_H }, 'Итого', { kind: 'cell', bold: true, max: 9, field });
  p.y += GRID_ROW_H;
}

function gridLine(p: Pager, label: string, cells: number[], total: number, cw: number, field: string, bold = false): void {
  textIn(p, { x: MARGIN, y: p.y, w: COLOR_W, h: GRID_ROW_H }, label, { kind: 'cell', bold, max: 9, field });
  cells.forEach((n, i) => {
    textIn(p, { x: MARGIN + COLOR_W + i * cw, y: p.y, w: cw, h: GRID_ROW_H }, n ? String(n) : '', { kind: 'cell', bold, max: 9, field });
  });
  textIn(p, { x: MARGIN + COLOR_W + cells.length * cw, y: p.y, w: TOTAL_W, h: GRID_ROW_H }, String(total), { kind: 'cell', bold: true, max: 9, field });
  p.y += GRID_ROW_H;
}

/** Сетка ЦВ/РАЗМ: по `perPage` строк цветов на странице, шапка повторяется */
export function gridTable(p: Pager, grid: TzGrid, perPage: number, title: string, field = 'Сетка ЦВ/РАЗМ'): void {
  const cw = (CONTENT_W - COLOR_W - TOTAL_W) / Math.max(1, grid.sizes.length);
  const chunks: TzGrid['rows'][] = [];
  for (let i = 0; i < grid.rows.length; i += perPage) chunks.push(grid.rows.slice(i, i + perPage));
  if (chunks.length === 0) chunks.push([]);
  chunks.forEach((rows, ci) => {
    const last = ci === chunks.length - 1;
    const h = GRID_ROW_H * (1 + rows.length + (last ? 1 : 0));
    if (ci > 0) newPage(p, `${title} — продолжение сетки`);
    else ensure(p, h, title);
    gridHead(p, grid, cw, field);
    rows.forEach((r) => gridLine(p, r.color || '—', r.cells, r.total, cw, field));
    if (last) gridLine(p, 'Итого', grid.totals, grid.total, cw, field, true);
  });
}

const MATRIX_ROW_H = 5.5;
const ZONE_W = 60;

/** Матрица «зона × техника»: строки зон, столбцы Ш / В / Т / DTG / П, отметка — галочкой */
export function matrixTable(p: Pager, matrix: TzMatrixRow[], title: string): void {
  const cw = (CONTENT_W - ZONE_W) / TZ_COLUMNS.length;
  const field = 'Матрица зон';
  ensure(p, MATRIX_ROW_H * (matrix.length + 1), title);
  textIn(p, { x: MARGIN, y: p.y, w: ZONE_W, h: MATRIX_ROW_H }, 'Зона / техника', { kind: 'cell', bold: true, max: 9, field });
  TZ_COLUMNS.forEach((c, i) => {
    textIn(p, { x: MARGIN + ZONE_W + i * cw, y: p.y, w: cw, h: MATRIX_ROW_H }, c, { kind: 'cell', bold: true, max: 9, field });
  });
  p.y += MATRIX_ROW_H;
  for (const r of matrix) {
    ensure(p, MATRIX_ROW_H, `${title} — продолжение матрицы`);
    textIn(p, { x: MARGIN, y: p.y, w: ZONE_W, h: MATRIX_ROW_H }, r.rowLabel, { kind: 'cell', max: 9, field });
    TZ_COLUMNS.forEach((c, i) => {
      add(p, { x: MARGIN + ZONE_W + i * cw, y: p.y, w: cw, h: MATRIX_ROW_H, kind: 'check', checked: r.cols.includes(c) });
    });
    p.y += MATRIX_ROW_H;
  }
}
