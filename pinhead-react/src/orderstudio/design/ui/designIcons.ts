/**
 * Иконки вкладки «Дизайн» — свой набор Order (веха 5а, план, решение 9).
 *
 * Из ERP в `design/**` — ни одного импорта, даже разрешённых Order примитивов
 * `Icon`/`icons` (ERP заморожен, а их импорт сдвинул бы разрезку чанков
 * оболочки ERP — бюджет). Формат форм тот же, что у ERP `icons.js`:
 * `{ t, ...attrs }`, сетка 24×24, обводка `currentColor`, без заливки; рисует
 * `DesignIcon.jsx`. Здесь только данные — файл не попадает под правило
 * react-refresh «из файла компонента — только компоненты».
 *
 * Формы — по мотивам набора Lucide (https://lucide.dev), лицензия ISC:
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part
 * of Feather (MIT). All other copyright (c) for Lucide are held by Lucide
 * Contributors 2022. Permission to use, copy, modify, and/or distribute this
 * software for any purpose with or without fee is hereby granted, provided that
 * the above copyright notice and this permission notice appear in all copies.
 * `polyline`/`line` Lucide переписаны в `path`: набор держит три фигуры.
 */

export interface IconShape {
  t: 'path' | 'circle' | 'rect';
  [attr: string]: string | number;
}

const p = (d: string): IconShape => ({ t: 'path', d });
const c = (cx: number, cy: number, r: number): IconShape => ({ t: 'circle', cx, cy, r });
const r = (x: number, y: number, width: number, height: number, rx: number): IconShape => ({ t: 'rect', x, y, width, height, rx });

export const DESIGN_ICONS = {
  /* ── Файл и вывод ── */
  upload: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('M17 8l-5-5-5 5'), p('M12 3v12')],
  download: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('M7 10l5 5 5-5'), p('M12 15V3')],

  /* ── История ── */
  undo: [p('M9 14 4 9l5-5'), p('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  redo: [p('m15 14 5-5-5-5'), p('M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],

  /* ── Геометрия нанесения ── */
  flipH: [p('m3 7 5 5-5 5V7'), p('m21 7-5 5 5 5V7'), p('M12 20v2'), p('M12 14v2'), p('M12 8v2'), p('M12 2v2')],
  flipV: [p('m17 3-5 5-5-5h10'), p('m17 21-5-5-5 5h10'), p('M4 12H2'), p('M10 12H8'), p('M16 12h-2'), p('M22 12h-2')],
  rotateCw: [p('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'), p('M21 3v5h-5')],
  rotateCcw: [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5')],
  lock: [r(3, 11, 18, 11, 2), p('M7 11V7a5 5 0 0 1 10 0v4')],
  unlock: [r(3, 11, 18, 11, 2), p('M7 11V7a5 5 0 0 1 9.9-1')],

  /* ── Слои ── */
  layers: [
    p('M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z'),
    p('m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65'),
    p('m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65'),
  ],
  copy: [r(8, 8, 14, 14, 2), p('M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2')],
  chevronUp: [p('m18 15-6-6-6 6')],
  chevronDown: [p('m6 9 6 6 6-6')],
  /** «Снять с изделия» — нанесение уходит с холста, строка остаётся */
  eyeOff: [
    p('M10.73 5.08A10.74 10.74 0 0 1 21.94 11.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49'),
    p('M14.08 14.16a3 3 0 0 1-4.24-4.24'),
    p('M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 4.45-5.14'),
    p('m2 2 20 20'),
  ],
  close: [p('M18 6 6 18'), p('m6 6 12 12')],

  /* ── Масштаб ── */
  zoomIn: [c(11, 11, 8), p('m21 21-4.35-4.35'), p('M11 8v6'), p('M8 11h6')],
  zoomOut: [c(11, 11, 8), p('m21 21-4.35-4.35'), p('M8 11h6')],
  fit: [p('M8 3H5a2 2 0 0 0-2 2v3'), p('M21 8V5a2 2 0 0 0-2-2h-3'), p('M3 16v3a2 2 0 0 0 2 2h3'), p('M16 21h3a2 2 0 0 0 2-2v-3')],

  /* ── Состояния ── */
  warning: [p('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'), p('M12 9v4'), p('M12 17h.01')],
} satisfies Record<string, IconShape[]>;

export type DesignIconName = keyof typeof DESIGN_ICONS;

export const DESIGN_ICON_NAMES = Object.keys(DESIGN_ICONS) as DesignIconName[];
