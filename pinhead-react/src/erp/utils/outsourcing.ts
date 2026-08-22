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
 * Код участка «Подряд» (правки заказчика 21.08).
 *
 * Документ просит отдельный участок в списке участков: выбрал «Подряд» —
 * исполнитель проставился сам, поля подрядчика раскрылись. Это ТОЧКА ВВОДА
 * и только она.
 *
 * ОТСЕВ ПОДРЯДА ВЕЗДЕ ОСТАЁТСЯ ПО `executor`, а не по этому коду, и это
 * не педантизм: этапы, заведённые до 21.08, стоят на реальном цехе
 * (`dtf`, `sewing`) с `executor='contractor'` — по коду участка они молча
 * перестали бы быть подрядными и всплыли бы в очереди чужого цеха. Правило
 * одно: подрядность — свойство ЭТАПА, участок лишь помогает его задать.
 */
export const OUTSOURCE_DEPT_CODE = 'outsource';

/**
 * ⚠️ СОВПАДЕНИЕ ИМЁН, КОТОРОЕ НЕ ЯВЛЯЕТСЯ СВЯЗЬЮ. Значение `'outsource'` есть
 * ещё и у `erp_order_items.production_type` («подряд под ключ» — тип
 * производства ПОЗИЦИИ). Это разные колонки в разных таблицах и разные
 * решения: тип производства говорит, кто делает изделие целиком, участок —
 * где в маршруте один конкретный шаг уходит наружу. Плитка `outsource`
 * из формы создания убрана ещё 20.08; сравнивать одно с другим нельзя,
 * и `production_type === 'outsource'` НЕ означает подрядный этап.
 */

/**
 * Исполнитель, который следует из выбранного участка.
 *
 * Живёт здесь, рядом с `isOutsourced`, потому что это две стороны одного
 * правила: как подрядность ЗАДАЁТСЯ и как она ЧИТАЕТСЯ. Разведи их по разным
 * файлам — и однажды участок «Подряд» перестанет давать подрядный этап.
 */
export function executorForDept(code: string): 'internal' | 'contractor' {
  return code === OUTSOURCE_DEPT_CODE ? 'contractor' : 'internal';
}

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

/**
 * Расхождение по подрядному этапу: не вернулось · ждёт приёмки · брак.
 *
 * ПОЧЕМУ БРАК БОЛЬШЕ НЕ ВЫВОДИТСЯ ИЗ РАЗНИЦЫ (правка 22.08, п. 3.9).
 * Раньше здесь стояло `defect = вернулось − принято`, и сценарий «передано
 * 200, вернулось 200, принято 0» показывал «брак: 200». Это неправда:
 * изделия ещё просто не проходили приёмку. Документ формулирует критерий
 * прямо — «брак появляется только после того, как пользователь явно отметил
 * конкретное количество как брак». Поэтому брак теперь ХРАНИТСЯ
 * (`qty_defect`, сумма журнальных записей `defect`), а из разницы выводится
 * `awaitingAccept` — «вернулось, но ещё не разобрано».
 *
 * Правило «не заводить второго писателя» при этом не нарушено: писатель
 * у `qty_defect` ровно один — тот же триггер `erp_subcontract_moves_rollup`,
 * что ведёт остальные количества.
 *
 * `lost` — передали, но не вернулось. При материалах ПОДРЯДЧИКА он не
 * считается вовсе: мы ничего не передавали, и «не вернулось 200» было бы
 * враньём (п. 3.8). Отрицательных значений не бывает по построению.
 */
export function subcontractShortfall(sub: {
  qty_sent?: number | null;
  qty_returned?: number | null;
  qty_accepted?: number | null;
  qty_defect?: number | null;
  material_source?: string | null;
} | null | undefined): { lost: number; awaitingAccept: number; defect: number } {
  const sent = Number(sub?.qty_sent ?? 0);
  const returned = Number(sub?.qty_returned ?? 0);
  const accepted = Number(sub?.qty_accepted ?? 0);
  const defect = Number(sub?.qty_defect ?? 0);
  const contractorMaterials = sub?.material_source === 'contractor';
  return {
    lost: contractorMaterials ? 0 : Math.max(0, sent - returned),
    awaitingAccept: Math.max(0, returned - accepted - defect),
    defect,
  };
}

/**
 * ГДЕ ЗАКАЗ СЕЙЧАС — главный вопрос раздела «Подряд» (правка 22.08, пп. 3.6–3.7).
 *
 * ЧТО БЫЛО НЕ ТАК. Ответ выводился ИЗ МАРШРУТА: текущий этап подрядный —
 * значит «У подрядчика». Пока передача не зафиксирована, это неправда:
 * этап может стоять в «Готово к передаче» с нулём переданных единиц,
 * а изделия физически лежат у нас. Второй случай — будущий подрядный этап
 * на участке «Подряд»: он отвечал «У нас: Подряд», что не объясняет вообще
 * ничего и вдобавок читается как местоположение.
 *
 * ТЕПЕРЬ ОТВЕТ ИДЁТ ОТ ФАКТА ПЕРЕДАЧИ. Местонахождение определяет ФАЗА
 * подряда — она двигается только действиями, и каждое из них означает
 * физическое перемещение партии. Маршрут отвечает лишь на вопрос «дошла ли
 * очередь до этого этапа».
 *
 * `phase` принимается параметром, а не вычисляется здесь: показываемую фазу
 * считает `subcontractView` (первые две фазы не хранятся), и второй расчёт
 * рядом разошёлся бы с первым.
 */
export function stageLocation(
  item: ItemLike | null | undefined,
  stage: Pick<ErpItemStage, 'id' | 'status' | 'contractor'>,
  phase: string,
): string {
  if (CLOSED.has(stage.status)) return 'Передано дальше по маршруту';

  const contractor = stage.contractor?.trim() || 'подрядчик не указан';
  if (phase === 'at_contractor' || phase === 'sent') return `У подрядчика: ${contractor}`;
  if (phase === 'ready_at_contractor') return `У подрядчика: ${contractor} — готово, забрать`;
  if (phase === 'rework') return `У подрядчика: ${contractor} — переделка`;
  if (phase === 'returned') return 'Вернулось в Pinhead · ожидает приёмки';
  if (phase === 'accepted' || phase === 'closed') return 'Принято на складе Pinhead';

  /**
   * Осталось «ещё не передавали». Различаем два состояния, и это прямое
   * требование п. 3.7: этап, до которого очередь не дошла, не должен
   * создавать впечатление, что заказ где-то физически находится.
   */
  const cur = currentStage(item);
  if (cur && cur.id !== stage.id) return 'Запланировано · ждёт предыдущий этап';
  return 'У Pinhead · готово к передаче';
}
