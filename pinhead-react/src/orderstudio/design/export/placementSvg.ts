/**
 * Общие куски сцены превью и PDF: клип нанесения по его зоне и картинка
 * нанесения с поворотом и отражением вокруг центра (как в DM).
 */
import type { FlatView, Placement } from '../types';
import { viewZone } from '../geometry/view';
import { escAttr, num, safeImageHref } from './svgText';

/** `<clipPath>` зоны нанесения */
export function clipRect(view: FlatView, p: Placement, id: string): string {
  const { zone } = viewZone(view, undefined, p.area_id);
  return `<clipPath id="${escAttr(id)}"><rect x="${num(zone.zx)}" y="${num(zone.zy)}" width="${num(zone.zw)}" height="${num(zone.zh)}"/></clipPath>`;
}

/** Картинка нанесения; нет безопасной картинки — пусто */
export function placementImage(p: Placement, href: string | undefined, clipId: string, attrs = ''): string {
  const safe = safeImageHref(href);
  if (!safe) return '';
  const cx = p.x_mm + p.width_mm / 2;
  const cy = p.y_mm + p.height_mm / 2;
  const sx = p.flip_h ? -1 : 1;
  const sy = p.flip_v ? -1 : 1;
  const transform = `rotate(${num(p.rotation_deg)} ${num(cx)} ${num(cy)}) translate(${num(cx)} ${num(cy)}) scale(${sx} ${sy}) translate(${num(-cx)} ${num(-cy)})`;
  return `<g${attrs} clip-path="url(#${escAttr(clipId)})"><g transform="${transform}">`
    + `<image href="${safe}" x="${num(p.x_mm)}" y="${num(p.y_mm)}" width="${num(p.width_mm)}" height="${num(p.height_mm)}" preserveAspectRatio="none"/>`
    + '</g></g>';
}
