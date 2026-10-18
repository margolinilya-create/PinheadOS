/**
 * Тексты холста для вспомогательных технологий (веха 5а, задача 6а):
 * имя области (`role="application"`), подсказка клавиш (`aria-describedby`)
 * и пересказ выбранного нанесения для `aria-live` — «Нанесение 1:
 * 120 × 80 мм, 80 мм от шва горловины» (план, «Клавиатура»).
 *
 * Номер нанесения — его место в позиции (номер в ТЗ), а не на виде.
 */
import type { SalesPrint } from '../../../model/types';
import type { DesignView } from '../../types';

export const VIEW_NAMES: Record<DesignView, string> = { front: 'перед', back: 'спина' };

/** Пауза пересказа для aria-live (проверка скиллами, ~500 мс): протяжка и серия стрелок не тараторят */
export const ANNOUNCE_DELAY_MS = 500;

export function canvasLabel(model: string, view: DesignView): string {
  return `Холст: ${model}, вид ${VIEW_NAMES[view]}`;
}

export function canvasHint(readOnly: boolean): string {
  if (readOnly) return 'Только просмотр: заказ уже не черновик. Масштаб — кнопки «+» и «−» или Ctrl и колесо мыши.';
  return 'Стрелки — сдвиг на 1 мм, с Shift — на 10 мм. Delete — снять с изделия. '
    + 'Ctrl+Z — отменить, Ctrl+Shift+Z — вернуть. Esc — снять выбор. '
    + 'Нанесение выбирается в списке нанесений; логотип можно перетащить на холст или вставить через Ctrl+V.';
}

const OFFSET_FROM: Partial<Record<SalesPrint['offset_from'], string>> = {
  neck_seam: 'шва горловины',
  top_edge: 'верхнего края',
  part_seam: 'шва',
};

function offsetText(p: SalesPrint): string {
  const from = OFFSET_FROM[p.offset_from];
  if (p.offset_mm === null || !from) return '';
  return p.offset_dir === 'up' ? `${p.offset_mm} мм выше ${from}` : `${p.offset_mm} мм от ${from}`;
}

/** Пересказ нанесения: номер, Ш × В, отступ, выход за зону */
export function announcePrint(index: number, p: SalesPrint, outOfZone: boolean): string {
  const parts = [
    p.width_mm && p.height_mm ? `${p.width_mm} × ${p.height_mm} мм` : '',
    offsetText(p),
    outOfZone ? 'выходит за зону' : '',
  ].filter(Boolean);
  const head = `Нанесение ${index + 1}`;
  return parts.length ? `${head}: ${parts.join(', ')}` : head;
}
