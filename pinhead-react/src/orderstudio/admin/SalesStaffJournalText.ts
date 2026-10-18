/**
 * Текст строки журнала «Кто и когда менял» (веха 8, К6) — без React,
 * чтобы экран оставался модулем одного компонента (fast refresh).
 */
import type { SalesStaffEvent } from '../api/salesStaff';

/** Признак → подпись в журнале (как колонки таблицы) */
const KIND_LABEL: Record<string, string> = { sales: 'Ведёт заказы', ms: 'МС' };

const p2 = (n: number): string => String(n).padStart(2, '0');

/** «17.10, 14:03» по местному времени; не дата — пусто */
export function eventWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}, ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * Строка журнала: «17.10, 14:03 — Петрова П.: „Ведёт заказы“ — да (Иванова И.)».
 * Кто сменил — в скобках (без «отметил/отметила»: пол по профилю неизвестен);
 * служебная смена (SQL Editor, service_role) — «(служебно)».
 */
export function eventText(ev: SalesStaffEvent, nameOf: (id: string) => string): string {
  const who = ev.actor ? nameOf(ev.actor) : 'служебно';
  const kind = KIND_LABEL[ev.kind] ?? ev.kind;
  return `${eventWhen(ev.at)} — ${nameOf(ev.profile_id)}: „${kind}“ — ${ev.on_value ? 'да' : 'нет'} (${who})`;
}
