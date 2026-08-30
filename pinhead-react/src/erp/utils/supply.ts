import type { ErpDepartment, ErpItemStage, ErpMaterial } from '../types';

/**
 * Закупка как ЭТАП МАРШРУТА — единственный источник правды.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Этап «Закупка» и раздел «Закупка» были двумя несвязанными
 * сущностями: экран строил таблицу из `order.materials` и об этапах не знал
 * вовсе, а `maybeCloseSupply` держал свою копию правила «какие этапы считать
 * открытыми». Из-за этого заказ, у которого этап закупки есть, а материалов
 * ещё нет, не показывался НИГДЕ — ни в разделе закупки (нет материалов),
 * ни в очереди, ни на канбане (`supply.is_production = false`). Закупка
 * не могла начать работу, и весь маршрут за ней стоял: на боевой базе
 * 33 таких этапа, включая пять заказов, созданных заказчиком 12.08.
 *
 * Модуль-лист без зависимостей: его импортируют и оболочка (бейдж меню),
 * и экран, и слайс материалов. Вторая копия любого правила отсюда — это
 * ровно тот способ, которым дефект и появился.
 */

/** Этапы, которые больше не ждут работы закупки */
const CLOSED: ReadonlySet<string> = new Set(['done', 'skipped']);

/** Цех закупки из справочника (кода `supply` в коде больше нигде быть не должно) */
export function findSupplyDept<T extends { code: string }>(
  departments: readonly T[] | null | undefined,
): T | null {
  return (departments ?? []).find((d) => d.code === 'supply') ?? null;
}

interface OrderLike {
  items?: { stages?: ErpItemStage[] }[];
}

/**
 * Открытые этапы закупки заказа.
 *
 * Их несколько: этап `supply` заводится на КАЖДУЮ позицию, а материалы
 * принадлежат заказу целиком (`erp_materials.order_id`). Поэтому закупка
 * ведётся по заказу, а закрывается сразу по всем его открытым этапам —
 * так уже делает автозакрытие, и ручное действие обязано совпадать с ним.
 */
export function openSupplyStages(
  order: OrderLike | null | undefined,
  supplyDeptId: string | null | undefined,
): ErpItemStage[] {
  if (!order || !supplyDeptId) return [];
  const out: ErpItemStage[] = [];
  for (const item of order.items ?? []) {
    for (const stage of item.stages ?? []) {
      if (stage.department_id === supplyDeptId && !CLOSED.has(stage.status)) out.push(stage);
    }
  }
  return out;
}

/**
 * Состояние закупки по заказу для строки списка.
 *
 * `taken` — закупку уже взяли в работу (хотя бы один этап `in_progress`).
 * `blocked` — этап заблокирован цехом, работать нельзя, пока не снимут.
 */
export type SupplyState = 'blocked' | 'taken' | 'open' | 'done';

export function supplyState(stages: readonly ErpItemStage[]): SupplyState {
  /**
   * ПУСТОЙ СПИСОК — ЭТО «ЗАВЕРШЕНО», А НЕ «ОЖИДАЕТ» (правка 24.08, п. 2).
   *
   * Функция принимает ОТКРЫТЫЕ этапы закупки (`openSupplyStages`), поэтому
   * пустой список означает ровно одно: открытых этапов не осталось. До правки
   * он падал в `open`, и архив завершённых закупок помечал каждую строку
   * «Ожидает» — прямая неправда на экране, где заказчик и просил показать
   * «Завершено».
   */
  if (stages.length === 0) return 'done';
  if (stages.some((st) => st.status === 'blocked')) return 'blocked';
  if (stages.some((st) => st.status === 'in_progress')) return 'taken';
  return 'open';
}

/**
 * Подпись и вид бейджа состояния — РЯДОМ С САМИМ СОСТОЯНИЕМ.
 *
 * Показывают его двое (строка списка и карточка закупки), и до правки 24.08
 * у каждого была своя таблица. Расхождение вышло молчаливым и мгновенным:
 * состояние `done` завели в одной копии, вторая на архивном заказе прочитала
 * `undefined.variant` и уронила ВЕСЬ экран закупки — «Не удалось загрузить
 * экран». `Record<SupplyState, …>` делает пропуск ошибкой тайпчека, а не
 * находкой на планшете.
 */
export const SUPPLY_STATE_BADGE: Record<
  SupplyState,
  { label: string; variant: string }
> = {
  blocked: { label: 'Заблокировано', variant: 'blocked' },
  taken: { label: 'В работе', variant: 'progress' },
  open: { label: 'Ожидает', variant: 'waiting' },
  done: { label: 'Завершено', variant: 'ready' },
};

/** Материал «на месте»: пришёл, зарезервирован со склада или не требуется */
export function isMaterialSettled(m: Pick<ErpMaterial, 'status'>): boolean {
  return m.status === 'received' || m.status === 'reserved' || m.status === 'not_needed';
}

/**
 * ЧТО МЕШАЕТ ЗАВЕРШИТЬ ЭТАП, ПОКА ЗАКУПКА НЕ ЗАКРЫТА (правка заказчика
 * 30.08, п. 5).
 *
 * ЗАЧЕМ ЭТО ОТДЕЛЬНОЕ ПРАВИЛО. Все гейты производства до сих пор стояли
 * на ВХОДЕ — в `isStageReady`, то есть на «Взять в работу». Как только этап
 * оказывался `in_progress`, завершить его можно было всегда, и закрой
 * закрывался при неприехавшей ткани, открывая следующий цех на тираж,
 * которого физически нет. Материальный гейт входа этого не ловит: работу
 * начинают, когда пришла часть, а документ запрещает именно ЗАКРЫТЬ этап.
 *
 * ГРАНИЦА ПРОВЕДЕНА ПО ЦЕХУ, А НЕ ПО КОДУ УЧАСТКА. Правило применяется
 * к цехам, которым в админке задан материальный гейт
 * (`erp_departments.gate_material_kinds`) — сегодня это закрой, о котором
 * и говорит документ. Константы вида «ткань → закрой» в коде запрещены
 * правилом проекта: участок, заведённый в админке завтра, обязан попадать
 * под то же правило, а не остаться незащищённым. Пусто = не гейтится
 * (fail-open) — цех не должен вставать из-за незаполненной настройки.
 *
 * ПРОВЕРЯЮТСЯ ВСЕ ПОЗИЦИИ ЗАКУПКИ ЗАКАЗА, а не только виды из гейта:
 * документ говорит «хотя бы одна позиция закупки», и это осознанно шире
 * входного гейта — там речь про «чем работать сейчас», здесь про «всё ли
 * приехало».
 *
 * «НЕ ТРЕБУЕТСЯ» НЕ БЛОКИРУЕТ (решение заказчика). Буквальное прочтение
 * документа — «любой статус кроме „Пришло" и „Доступен со склада"» —
 * включило бы `not_needed`, и заказ со строкой «не требуется» не закрылся
 * бы НИКОГДА. Условие взято у `isMaterialSettled`, то есть ровно то же,
 * которым закупка считается завершённой в остальном разделе.
 */
export function materialsBlockingCompletion(
  materials: readonly ErpMaterial[] | null | undefined,
  dept: Pick<ErpDepartment, 'gate_material_kinds'> | null | undefined,
): ErpMaterial[] {
  if (!dept || (dept.gate_material_kinds ?? []).length === 0) return [];
  return (materials ?? []).filter((m) => !isMaterialSettled(m));
}

export interface SupplyMaterialSummary {
  total: number;
  settled: number;
  /** Все материалы на месте И их вообще завели */
  allSettled: boolean;
  /**
   * Закупаемые позиции без планового количества. Приёмка на складе сверяет
   * факт с планом, и без него сделка дальше не идёт (правка 4.1.3).
   */
  missingPlan: ErpMaterial[];
  /** Сколько строк закупщик уже оформил (есть заказанное кол-во или дата заказа) */
  ordered: number;
  /** Сколько в пути */
  inTransit: number;
  /** Сколько пришло или зарезервировано со склада */
  arrived: number;
  /** Сколько ещё не оформлено закупщиком (документ 23.08, п. 1.3) */
  notOrdered: number;
  /**
   * Позиции с проблемой: план прихода прошёл, а материал не на месте, либо
   * у закупаемой строки нет планового количества (без него приёмка на складе
   * не сверится, и закупка не закроется автоматически никогда).
   */
  problems: ErpMaterial[];
}

export function supplyMaterialSummary(
  materials: readonly ErpMaterial[] | null | undefined,
  today: string | null = null,
): SupplyMaterialSummary {
  const list = materials ?? [];
  const settled = list.filter(isMaterialSettled).length;
  return {
    total: list.length,
    settled,
    allSettled: list.length > 0 && settled === list.length,
    missingPlan: list.filter(
      (m) => m.source === 'purchase' && (m.qty_expected == null || m.qty_expected <= 0)),
    /**
     * Счётчики шапки карточки закупки (документ 20.08, п. 6): «общее количество
     * позиций закупки; сколько оформлено; сколько в пути; сколько уже пришло».
     *
     * «Оформлено» — это ФАКТ ЗАКУПЩИКА, а не статус: строка считается
     * оформленной, когда указано, сколько заказано, или дата заказа. Статус
     * `ordered` для этого не годится — его ставят и до того, как узнали
     * количество и цену, а документ спрашивает именно «сколько оформлено».
     */
    ordered: list.filter(
      (m) => (m.qty_ordered != null && m.qty_ordered > 0) || Boolean(m.ordered_on)).length,
    inTransit: list.filter(
      (m) => m.status === 'ordered' || m.status === 'in_transit' || m.status === 'partial').length,
    arrived: list.filter((m) => m.status === 'received' || m.status === 'reserved').length,
    notOrdered: list.length - list.filter(
      (m) => (m.qty_ordered != null && m.qty_ordered > 0) || Boolean(m.ordered_on)).length,
    /**
     * «Проблемы или просрочено» из сводки карточки (п. 1.3). Считается ЗДЕСЬ,
     * а не на экране: величина закупочная, и вторая её реализация рядом
     * с таблицей разошлась бы с плиткой молча — обе «работают», просто
     * считают разное.
     *
     * `today` передаётся аргументом, а не берётся из `Date`: календарный день
     * в проекте даёт `utils/date`, а чистая функция не должна зависеть
     * от часов машины (правило тестов дат).
     */
    problems: list.filter((m) => {
      if (isMaterialSettled(m)) return false;
      if (m.source === 'purchase' && (m.qty_expected == null || m.qty_expected <= 0)) return true;
      return Boolean(today && m.eta_date && m.eta_date < today);
    }),
  };
}

/**
 * Считает заказы, ждущие закупки, — бейдж пункта меню.
 *
 * Прежде бейдж считал только `procurement_tasks` (дозакупки и замены), а они
 * заводятся ИСКЛЮЧИТЕЛЬНО из брака. Заказ, у которого закупка — первый этап
 * маршрута, счётчик не увеличивал вовсе, поэтому в раздел никто и не заходил:
 * пункт меню молчал ровно тогда, когда работа там была.
 *
 * Считаем ЗАКАЗЫ, а не этапы: заказ из трёх позиций даёт три этапа закупки,
 * но работа по нему одна, и «3» на бейдже означало бы втрое больше дел,
 * чем есть.
 */
export function ordersAwaitingSupply<T extends OrderLike & { status: string }>(
  orders: readonly T[],
  departments: readonly ErpDepartment[] | null | undefined,
): T[] {
  const supply = findSupplyDept(departments);
  if (!supply) return [];
  return orders.filter(
    (o) => o.status === 'active' && openSupplyStages(o, supply.id).length > 0);
}

/**
 * СНАБЖЕНЧЕСКОЕ ЛИ ЭТО ОЖИДАНИЕ (правки заказчика 23.08, пп. 2 и 3).
 *
 * ЗАДАЧА, КОТОРУЮ РЕШАЕТ ФУНКЦИЯ. Документ требует ПРОТИВОПОЛОЖНОГО для двух
 * цехов на одном экране: у закроя «Ожидает» и «Ожидают материалы» объединить
 * («нет отдельного верхнеуровневого блока»), у швейки — оставить разными
 * («не объединять этот блок с обычным Ожидает»). Поцеховой настройки здесь
 * быть не может: правило проекта запрещает держать в коде константы вида
 * «ткань → закрой», а настройка в админке — это переключатель, о котором
 * через месяц никто не вспомнит.
 *
 * РАЗРЕШЕНИЕ: делим не по цеху, а по ПРИЧИНЕ, и обе формулировки документа
 * оказываются одним правилом.
 *   · снабжение — нет материалов, идёт закупка на замену, или блокирует этап
 *     НЕпроизводственного участка закупки;
 *   · производство — ждём предыдущий ЦЕХ или ТЗ.
 *
 * У закроя ожидание почти всегда снабженческое («Закупка: ещё не завершено»
 * приходит именно отсюда — этап `cutting` зависит от этапа `supply`), поэтому
 * группа «Ожидает» остаётся пустой и не рисуется вовсе: на экране одна
 * свёрнутая группа внизу, как и просит п. 2. У швейки наполнены обе, и они
 * разведены ровно по границе из п. 3: «Ожидает» — незавершённый закрой, ДТФ,
 * вышивка; «Ожидают материалы» — не хватает ткани, бирки, молнии.
 *
 * Участок закупки определяется ЧЕРЕЗ СПРАВОЧНИК (`findSupplyDept`), а не по
 * коду на месте: код `supply` живёт в этом файле ровно один раз.
 */
export function isSupplyWait(input: {
  /** Материалы, которых не хватает этапу */
  missingMaterials: readonly ErpMaterial[];
  /** Этап ждёт закупку материала на замену (`erp_procurement_tasks`) */
  awaitingProcurement: boolean;
  /** Проверяемый этап и все этапы позиции — чтобы пройти по `depends_on` */
  stage: Pick<ErpItemStage, 'depends_on'>;
  itemStages: readonly Pick<ErpItemStage, 'id' | 'status' | 'department_id'>[];
  supplyDeptId: string | null | undefined;
}): boolean {
  if (input.missingMaterials.length > 0) return true;
  if (input.awaitingProcurement) return true;
  if (!input.supplyDeptId) return false;
  const byId = new Map(input.itemStages.map((s) => [s.id, s]));
  return (input.stage.depends_on ?? []).some((id) => {
    const dep = byId.get(id);
    return !!dep && !CLOSED.has(dep.status) && dep.department_id === input.supplyDeptId;
  });
}
