/**
 * Чистые подписи экрана «К запуску» (веха 6+7, К22): сводка последствий
 * запуска, предупреждения даты, маршрут без стора ERP, следующий в очереди.
 *
 * Правило проекта: последствия необратимого действия считает утилита и
 * называет текстом — сводка стоит над кнопкой «Запустить в производство»
 * и связана с ней `aria-describedby`.
 */
import type { SalesOrder } from '../model/types';
import type { ProductionType } from '../../erp/types';
import type { SalesOrderListRow } from '../api/salesOrders';
import { METHOD_LABELS } from '../model/printMethods';
import { gridQty } from '../model/factory';
import { parseDateLocal } from '../../utils/date';
import { pluralize } from '../../utils/i18n';
import { tzToErpDraft } from '../bridge/tzToErpDraft';
import type { LaunchStage } from '../bridge/launch';
import { sortSalesList } from '../screens/salesListFilter';

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKEND = { 0: 'Воскресенье', 6: 'Суббота' } as Record<number, string>;

const p2 = (n: number) => String(n).padStart(2, '0');
const ddmm = (d: Date) => `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;

/** Тип производства — подпись для маршрута (зеркало `PRODUCTION_TYPE_LABELS` ERP без импорта) */
const PRODUCTION_LABELS: Record<ProductionType, string> = {
  no_product: 'Нанесение на изделие клиента',
  ready_garment: 'Готовое изделие',
  cut: 'Крой',
  sewing: 'Пошив',
  samples: 'Образцы',
  outsource: 'Подряд',
};

/** Позиции, которые уйдут в производство: вид изделия и количество (как `payloadItems` ERP) */
function launchItems(order: SalesOrder) {
  return order.items.filter((it) => it.product_type.trim() && gridQty(it.size_grid) > 0);
}

/**
 * Блокирующая ошибка даты: пусто или раньше сегодняшнего (`min` поля — только
 * подсказка браузеру, ручной ввод его обходит). `today` — `YYYY-MM-DD` по месту.
 */
export function launchDateError(date: string, today: string): string {
  if (!parseDateLocal(date)) return 'Укажите дату запуска';
  return date < today ? 'Дата запуска уже прошла — выберите сегодня или позже' : '';
}

/** Ход запуска для `aria-live` — по шагу `launchToErp` */
export const STAGE_TEXT: Record<LaunchStage, string> = {
  check: 'Проверяем готовность к запуску…',
  bootstrap: 'Загружаем справочники производства…',
  payload: 'Собираем заказ для производства…',
  tzcheck: 'Сверяем ТЗ с данными заказа…',
  files: 'Копируем ТЗ и макеты в производство…',
  recheck: 'Повторно проверяем заказ…',
  create: 'Создаём заказ в производстве…',
  transition: 'Обновляем статус заказа…',
};

/** Неблокирующие предупреждения даты запуска */
export function launchDateWarnings(date: string, dueDate: string | null | undefined): string[] {
  const d = parseDateLocal(date);
  if (!d) return [];
  const out: string[] = [];
  const due = parseDateLocal(dueDate ?? null);
  if (due && d > due) out.push(`Запуск ${ddmm(d)} позже срока сдачи ${ddmm(due)}`);
  if (WEEKEND[d.getDay()]) out.push(`${WEEKEND[d.getDay()]} — нерабочий день`);
  return out;
}

/** «Будет создан заказ в производстве: 3 позиции, 450 шт., запуск 20.10 (пн). Предупреждений моста: 1» */
export function launchSummary(order: SalesOrder, date: string, bridgeWarnings: number): string {
  const items = launchItems(order);
  const qty = items.reduce((n, it) => n + gridQty(it.size_grid), 0);
  const d = parseDateLocal(date);
  const when = d ? `, запуск ${ddmm(d)} (${WEEKDAY_SHORT[d.getDay()]})` : '';
  const head = `Будет создан заказ в производстве: ${items.length} ${pluralize(items.length, 'позиция', 'позиции', 'позиций')}, ${qty} шт.${when}.`;
  const warn = bridgeWarnings > 0 ? ` Предупреждений моста: ${bridgeWarnings}.` : '';
  return [head, warn, ...launchDateWarnings(date, order.due_date).map((w) => ` ${w}.`)].join('');
}

export interface RouteRow {
  key: string;
  name: string;
  qty: number;
  production: string;
  /** «по крою» / «по готовому изделию» — где идут нанесения */
  brandingOn: string | null;
  methods: string[];
}

/** Маршрут для просмотра: тип производства и техники по позициям (точный строит ERP при запуске) */
export function routeRows(order: SalesOrder): RouteRow[] {
  const draft = tzToErpDraft(order);
  const byKey = new Map(order.items.map((it) => [it.key, it]));
  return draft.items.flatMap((d, i) => {
    const it = d.key ? byKey.get(d.key) : undefined;
    if (!it || !it.product_type.trim() || gridQty(it.size_grid) === 0) return [];
    return [{
      key: it.key,
      name: it.product_type.trim() || `Позиция ${i + 1}`,
      qty: gridQty(it.size_grid),
      production: PRODUCTION_LABELS[d.production_type as ProductionType] ?? String(d.production_type),
      brandingOn: it.prints.length === 0 ? null : d.branding_on === 'finished' ? 'по готовому изделию' : 'по крою',
      methods: [...new Set(it.prints.map((p) => METHOD_LABELS[p.method]))],
    }];
  });
}

/** «Маржа 18 % (порог 25 %)»; доли — от 0 до 1 */
export function marginLine(marginPct: number, minMarginPct: number | null): { text: string; low: boolean } {
  const m = Math.round(marginPct * 100);
  if (minMarginPct == null) return { text: `Маржа ${m} %`, low: false };
  const t = Math.round(minMarginPct * 100);
  return { text: `Маржа ${m} % (порог ${t} %)`, low: marginPct < minMarginPct };
}

/** Следующий заказ очереди «К запуску» по сроку и сколько их осталось (без текущего) */
export function nextInQueue(list: readonly SalesOrderListRow[], currentId: string): { next: SalesOrderListRow | null; left: number } {
  const queue = sortSalesList(list.filter((r) => r.status === 'ready_to_launch' && r.id !== currentId), 'due');
  return { next: queue[0] ?? null, left: queue.length };
}
