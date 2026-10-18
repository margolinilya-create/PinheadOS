/**
 * Тексты оплаты заказа v4 (веха 6+7, К16) — общие для `PaymentPanel`,
 * бейджа оплаты и колонки «Оплата» списка.
 */
import { FACTORY_TIMEZONE } from '../../utils/date';
import type { SalesOrder } from '../model/types';

/** Предел причины «без оплаты» — как у RPC (`length(p_override_reason) > 500` — отказ) */
export const OVERRIDE_MAX = 500;

const DDMM = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', timeZone: FACTORY_TIMEZONE });

/** Дата события «дд.мм» по фабричному поясу; пусто или мусор — пусто */
export function ddmm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DDMM.format(d);
}

/** Статус оплаты текстом: «Оплата: не отмечена» / «Предоплата получена 18.10» / «Оплачен полностью 18.10» */
export function paymentStatusText(order: Pick<SalesOrder, 'paid_kind' | 'paid_at'>): string {
  if (order.paid_kind === 'prepaid') return `Предоплата получена ${ddmm(order.paid_at)}`.trim();
  if (order.paid_kind === 'full') return `Оплачен полностью ${ddmm(order.paid_at)}`.trim();
  return 'Оплата: не отмечена';
}

/** Строка «без оплаты» в режиме чтения: кто, когда и почему; без журнала — только причина */
export function overrideText(
  reason: string,
  note: { actorName: string; at: string; reason: string } | null,
): string {
  if (note) return `Запуск без оплаты разрешил(а) ${note.actorName} ${ddmm(note.at)}: «${note.reason}»`;
  return `Запуск без оплаты разрешён: «${reason}»`;
}
