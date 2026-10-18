/**
 * Тексты холста для вспомогательных технологий (веха 5а, задача 6а):
 * имя области (`role="application"`), подсказка клавиш (`aria-describedby`)
 * и пересказ выбранного нанесения для `aria-live` — «Нанесение 1:
 * 120 × 80 мм, 80 мм от шва горловины» (план, «Клавиатура»).
 *
 * Номер нанесения — его место в позиции (номер в ТЗ), а не на виде.
 */
import type { SalesPrint } from '../../../model/types';
import { offsetText } from '../../../model/printOffset';
import type { DesignView } from '../../types';

/** Вид в тексте («вид перед», «вид левый рукав»); рукава — с вехи 5б */
export const VIEW_NAMES: Record<DesignView, string> = {
  front: 'перед',
  back: 'спина',
  sleeve_left: 'левый рукав',
  sleeve_right: 'правый рукав',
};

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
