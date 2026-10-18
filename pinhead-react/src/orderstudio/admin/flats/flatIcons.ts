/**
 * Иконки редактора флэта (веха 5б, задача 7) — свой набор `admin/flats`, а не
 * `design/ui/designIcons`.
 *
 * Зачем отдельно: модуль, который статически импортируют и холст «Дизайн»,
 * и ленивый редактор флэта, Rollup выносит в общий чанк, а граф холста
 * считает его целиком и сжатым отдельно (бюджет холста ≤ 100 000 Б gzip,
 * план 5б, «Риски и откат»: `admin/flats` берёт у дизайна только `konva.ts`,
 * `flatVersion`, `resolveFlat`, прочее — свои модули). Общая `DesignIcon`
 * с иконками редактора стоила холсту ≈ 0,5 кБ.
 *
 * Формат и происхождение форм — как у `design/ui/designIcons.ts` (Lucide,
 * ISC; `polyline`/`line` переписаны в `path`). Общие с холстом имена
 * (`close`, `warning`) сверяет с набором дизайна тест `FlatIcon.test.jsx`.
 */
import type { IconShape } from '../../design/ui/designIcons';

const p = (d: string): IconShape => ({ t: 'path', d });
const c = (cx: number, cy: number, r: number): IconShape => ({ t: 'circle', cx, cy, r });

export const FLAT_ICONS = {
  plus: [p('M5 12h14'), p('M12 5v14')],
  trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'), p('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2')],
  arrowUp: [p('m5 12 7-7 7 7'), p('M12 19V5')],
  arrowDown: [p('M12 5v14'), p('m19 12-7 7-7-7')],
  anchor: [p('M12 22V8'), p('M5 12H2a10 10 0 0 0 20 0h-3'), c(12, 5, 3)],
  ruler: [
    p('M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z'),
    p('m14.5 12.5 2-2'), p('m11.5 9.5 2-2'), p('m8.5 6.5 2-2'), p('m17.5 15.5 2-2'),
  ],
  close: [p('M18 6 6 18'), p('m6 6 12 12')],
  warning: [p('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'), p('M12 9v4'), p('M12 17h.01')],
} satisfies Record<string, IconShape[]>;

export type FlatIconName = keyof typeof FLAT_ICONS;

export const FLAT_ICON_NAMES = Object.keys(FLAT_ICONS) as FlatIconName[];
