/**
 * Техника в цене нанесения (веха 5в, Э1): то, из чего формула сложила цену, —
 * формат сетки, раскладка на плёнке, стежки. Считает `priceOrder` теми же
 * функциями, что и цену (`screenFormat`, `fitFormat`, `dtfLayout`,
 * `embroideryPrice`); здесь — только подпись для панели «Дизайн».
 * Модуль чистый: без React и стора.
 */
import { pluralize } from '../../utils/i18n';

export type PrintTech =
  | { kind: 'screen'; fmt: string }
  | { kind: 'flex'; fmt: string }
  | { kind: 'dtf'; perMeter: number; cols: number }
  | { kind: 'emb'; stitches: number }
  | { kind: 'dtg'; size: string };

/** Разряды через неразрывный пробел — как в остальных числах интерфейса */
const groups = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const formatLabel = (fmt: string) => (fmt === 'Max' ? 'Max — больше A3+' : fmt);
const dtgLabel = (size: string) => {
  const cm = /^(\d+)x(\d+)$/.exec(size);
  return cm ? `${cm[1]} × ${cm[2]} см` : size;
};

export function printTechText(t: PrintTech): string {
  switch (t.kind) {
    case 'screen': return `Шелкография: формат ${formatLabel(t.fmt)}`;
    case 'flex': return `Флекс: формат ${t.fmt}`;
    case 'dtf': return `Плёнка: 1 м на ${t.perMeter} шт (${t.cols} в ряд)`;
    case 'emb': return `Вышивка: ≈ ${groups(t.stitches)} ${pluralize(t.stitches, 'стежок', 'стежка', 'стежков')}`;
    case 'dtg': return `DTG: формат ${dtgLabel(t.size)}`;
  }
}
