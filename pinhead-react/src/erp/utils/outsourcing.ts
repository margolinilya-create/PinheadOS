import type { ErpItemStage } from '../types';

/**
 * Подряд как ЭТАП МАРШРУТА — единственный источник правды.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Ровно та же история, что у `utils/supply.ts`. Раздел «Подряд»
 * вёл собственный список операций рядом с маршрутом заказа, и связь между ними —
 * колонка `erp_subcontracting.stage_id` — не заполнялась НИКЕМ: на боевой базе
 * две строки подряда, у обеих `stage_id is null`. Из-за этого «вернулось
 * от подрядчика» ничего не открывало дальше по маршруту, а раздел был тупиком.
 *
 * Теперь подряд — признак этапа (`executor='contractor'`), и правило «что такое
 * подрядный этап» обязано жить в ОДНОМ месте: им пользуются бейдж меню, экран
 * подряда, очередь цеха, канбан, загрузка и план. Вторая копия любого правила
 * отсюда — тот самый способ, которым появился дефект закупки.
 *
 * Модуль-лист без зависимостей: его импортирует и оболочка, и экраны.
 */

/** Этапы, которые больше не ждут работы */
const CLOSED: ReadonlySet<string> = new Set(['done', 'skipped']);

/**
 * Выполняет ли этап подрядчик.
 *
 * Сравниваем именно с `'contractor'`, а не с `!== 'internal'`: колонка новая,
 * и у этапов из старых фикстур, урезанных выборок и кэша её нет вовсе.
 * `undefined` обязан читаться как «наш» — иначе весь производственный поток
 * молча уехал бы в подряд.
 */
export function isOutsourced(stage: Pick<ErpItemStage, 'executor'>): boolean {
  return stage.executor === 'contractor';
}

/** Обратное: этап делаем мы. Отдельная функция, чтобы не писать `!isOutsourced` */
export function isInternal(stage: Pick<ErpItemStage, 'executor'>): boolean {
  return !isOutsourced(stage);
}

interface ItemLike {
  id?: string;
  product_type?: string;
  variant?: string | null;
  qty?: number;
  stages?: ErpItemStage[];
}

interface OrderLike {
  id?: string;
  status?: string;
  items?: ItemLike[];
}

export interface OutsourcedEntry {
  item: ItemLike;
  stage: ErpItemStage;
}

/** Все подрядные этапы заказа — и закрытые тоже (для истории маршрута) */
export function outsourcedStages(order: OrderLike | null | undefined): OutsourcedEntry[] {
  const out: OutsourcedEntry[] = [];
  for (const item of order?.items ?? []) {
    for (const stage of item.stages ?? []) {
      if (isOutsourced(stage)) out.push({ item, stage });
    }
  }
  return out;
}

/** Подрядные этапы, которые ещё требуют внимания */
export function openOutsourcedStages(order: OrderLike | null | undefined): OutsourcedEntry[] {
  return outsourcedStages(order).filter((e) => !CLOSED.has(e.stage.status));
}

/** Есть ли в заказе подряд вообще — для бейджа меню и фильтра списка */
export function hasOutsourcing(order: OrderLike | null | undefined): boolean {
  return outsourcedStages(order).length > 0;
}

/**
 * Заказы, которыми занимается раздел «Подряд».
 *
 * Считаем ЗАКАЗЫ, а не этапы: у заказа их может быть несколько (несколько
 * подрядчиков подряд — прямой сценарий документа), а в меню человеку нужно
 * число дел, а не число строк. Ровно так же считает `ordersAwaitingSupply`.
 */
export function ordersWithOutsourcing<T extends OrderLike>(
  orders: readonly T[] | null | undefined,
): T[] {
  return (orders ?? []).filter(
    (o) => o.status === 'active' && openOutsourcedStages(o).length > 0,
  );
}

/**
 * Следующий этап маршрута после указанного.
 *
 * ЭТО И ЕСТЬ ОТВЕТ НА ГЛАВНОЕ ТРЕБОВАНИЕ ДОКУМЕНТА: «"вернулось от подрядчика"
 * не означает, что заказ готов — система должна посмотреть следующий этап
 * маршрута». Ничего специального для этого делать не нужно: следующий этап уже
 * в маршруте и зависит от подрядного через `depends_on`. Функция нужна, чтобы
 * ПОКАЗАТЬ его человеку в колонке «Следующий этап», а не чтобы вычислить
 * переход — переход делает обычный гейт готовности.
 *
 * Ищем прямых потомков по графу; если их нет (ветка кончилась) — ближайший
 * незакрытый этап дальше по `sort_order`. Второе — для маршрутов, собранных
 * до появления конструктора, где зависимости могли остаться неполными.
 */
export function nextRouteStage(
  item: ItemLike | null | undefined,
  stage: Pick<ErpItemStage, 'id' | 'sort_order'>,
): ErpItemStage | null {
  const stages = item?.stages ?? [];
  const dependents = stages
    .filter((s) => (s.depends_on ?? []).includes(stage.id) && !CLOSED.has(s.status))
    .sort((a, b) => a.sort_order - b.sort_order);
  if (dependents.length > 0) return dependents[0];

  const later = stages
    .filter((s) => s.sort_order > stage.sort_order && !CLOSED.has(s.status))
    .sort((a, b) => a.sort_order - b.sort_order);
  return later[0] ?? null;
}

/**
 * Где заказ физически находится сейчас — главный вопрос экрана «Подряд».
 *
 * Первый незакрытый этап маршрута позиции: если он подрядный — заказ у него,
 * если наш — у нас. Пустая строка означает, что производство закончено;
 * подпись подбирает вызывающий, потому что она зависит от экрана.
 */
export function currentStage(item: ItemLike | null | undefined): ErpItemStage | null {
  const open = (item?.stages ?? [])
    .filter((s) => !CLOSED.has(s.status))
    .sort((a, b) => a.sort_order - b.sort_order);
  return open[0] ?? null;
}

/**
 * Подпись этапа. У подрядного берётся ОПЕРАЦИЯ, а не имя цеха: цех у него
 * означает «чей это участок ответственности», а человек хочет прочитать,
 * что именно делает подрядчик («Сублимация», а не «Цех ДТФ»).
 */
export function stageLabel(
  stage: Pick<ErpItemStage, 'executor' | 'operation'>,
  departmentName: string,
): string {
  if (isOutsourced(stage) && stage.operation?.trim()) return stage.operation.trim();
  return departmentName;
}
