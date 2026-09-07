/**
 * Маршрутная логика: тип производства + нанесения → этапы позиции.
 *
 * Источник: лист «Маршруты» Google-таблицы менеджера
 * (docs/erp/spreadsheet-analysis.md, раздел 2).
 *
 * Правила:
 * - Базовая цепочка по типу производства (закуп → закрой → швейка → ВТО...)
 * - Нанесения — параллельные ветки: на крое (между закроем и швейкой)
 *   или на готовом (после последнего этапа производства)
 * - ДТФ и термоперенос — один цех (dtf)
 * - «Прочие» нанесения (пришив нашивок) отдельного цеха не имеют
 */

import type {
  BrandingMethod,
  BrandingOn,
  ErpItemStage,
  ErpMaterial,
  ProductionType,
} from '../types';
import { formatDateShort } from './time';

export interface RouteStage {
  departmentCode: string;
  /** Коды цехов-предшественников (для depends_on при создании) */
  dependsOnCodes: string[];
  sortOrder: number;
}

/** Базовая цепочка этапов по типу производства (лист «Маршруты») */
const BASE_CHAIN: Record<ProductionType, string[]> = {
  no_product: [],
  ready_garment: ['supply'],
  cut: ['supply', 'cutting'],
  sewing: ['supply', 'cutting', 'sewing', 'vto'],
  /**
   * ОБРАЗЕЦ ШЬЁТСЯ ВНУТРИ ЭКСПЕРИМЕНТАЛЬНОГО ЦЕХА (правки заказчика 02.09,
   * пп. 1 и 3). «Если заказ отмечен как „образец“, закрой, пошив и остальные
   * внутренние этапы изготовления образца должны выполняться только внутри
   * экспериментального цеха. Отдельные задачи в обычных цехах „Закрой“,
   * „Швейка“, „ВТО“ и других не связанных с нанесениями цехах создаваться
   * и отображаться не должны».
   *
   * ПОЧЕМУ ЭТО РЕШАЕТСЯ ЗДЕСЬ, А НЕ ФИЛЬТРОМ ОЧЕРЕДИ. `origin` в маршрутную
   * логику не входит по построению, и очереди цехов по нему не фильтруют
   * (осознанно, см. `20260810230000`). Пока `BASE_CHAIN.samples` заводил
   * `cutting` и `sewing`, это были НАСТОЯЩИЕ этапы обычных цехов с
   * `origin='production'` — заказчик и видел один образец в двух местах сразу.
   * Документ просит не «спрятать», а НЕ СОЗДАВАТЬ.
   *
   * ВТО убрано раньше (правка 01.09, п. 4) и не возвращается: у образца этого
   * этапа нет вовсе. У серии (`sewing`) ВТО остаётся.
   *
   * `experimental` отдельным участком маршрута НЕ заводится: работа
   * экспериментального цеха живёт в `erp_experimental` (доска `board_stage`
   * и задачи разработки), а не в очереди производственного цеха. Тот же довод,
   * по которому финальный шаг «Склад» вычисляется, а не хранится этапом
   * (`utils/warehouseStep`).
   */
  samples: ['supply'],
  outsource: ['supply'],
};

/**
 * Метод нанесения → код цеха (null = отдельного цеха нет).
 *
 * ЭКСПОРТИРУЕТСЯ с 30.08 (п. 2): по этой же карте разработка образца строит
 * свои задачи нанесения из `erp_item_prints` заказа
 * (`experimentalBoard.devBrandingFromPrints`). Вторая такая карта означала бы,
 * что образец и серия однажды поедут разными цехами.
 */
export const BRANDING_DEPT: Record<BrandingMethod, string | null> = {
  embroidery: 'embroidery',
  silkscreen: 'silkscreen',
  dtf: 'dtf',
  /**
   * DTG БОЛЬШЕ НЕ СОЗДАЁТ ЭТАПА (правки 07.09, п. 17: «В заказах этап DTG
   * не создавать»). `null` — то же, что у `other`: отдельного участка нет.
   *
   * Значение остаётся в перечислении и в подписях: на боевой базе есть
   * заведённое нанесение с этим методом, и убери мы его из типа — карточка
   * заказа перестала бы его называть. Из ВЫБОРА метод убран
   * (`BRANDING_METHOD_CHOICES`), поэтому новых таких нанесений не появится.
   */
  dtg: null,
  heat_transfer: 'dtf', // тот же цех, колонка «DTF/Термоперенос»
  other: null,          // пришив нашивок и т.п. — внутри швейки
};

/**
 * Код цеха ОТК.
 *
 * Отдельного участка контроля в структуре производства больше нет (правки
 * заказчика 10.08): в маршрут он не добавляется, сам цех деактивирован. Константа
 * оставлена, потому что по ней всё ещё узнают старые этапы и сид справочника —
 * искать строку `'qc'` по коду хуже, чем держать одно имя.
 */
export const QC_DEPT_CODE = 'qc';

/**
 * Код склада. Приёмка готового изделия — ЭТАП этого участка (правки 07.09,
 * п. 9), см. подробное обоснование в `buildRoute`.
 */
export const WAREHOUSE_DEPT_CODE = 'warehouse';

/** Код цеха ВТО: у готового изделия он дописывается ПОСЛЕ нанесения */
export const VTO_DEPT_CODE = 'vto';

export interface BuildRouteInput {
  productionType: ProductionType;
  brandingMethods: BrandingMethod[];
  brandingOn: BrandingOn;
}

/**
 * Строит маршрут позиции: список этапов с зависимостями.
 * Нанесение на крое встраивается между закроем и швейкой,
 * на готовом — после последнего этапа базовой цепочки.
 */
export function buildRoute(input: BuildRouteInput): RouteStage[] {
  const { productionType, brandingMethods, brandingOn } = input;

  /**
   * НАНЕСЕНИЯ ОБРАЗЦА В МАРШРУТ НЕ ПОПАДАЮТ (правки 02.09, п. 3, шаги 5–6).
   *
   * Документ описывает их появление как СОБЫТИЕ, а не как заранее известный
   * этап: «технолог вручную переводит карточку образца из „Кроя“ в этап
   * „Нанесения“… одновременно в обычном производственном цехе автоматически
   * появляется ТОЛЬКО то нанесение, которое менеджер указал при заведении
   * заказа». Этап заводит `erp_experimental_task_send` в этот момент.
   *
   * Пред-созданный этап был бы хуже дважды. Во-первых, цех увидел бы работу
   * раньше, чем образец скроен. Во-вторых, ждать ему стало нечего: `cutting`,
   * от закрытия которого этап нанесения открывался, из маршрута образца ушёл, —
   * то есть этап встал бы в очередь цеха готовым к работе сразу после закупки.
   */
  const brandingCodes = productionType === 'samples' ? [] : [...new Set(
    brandingMethods.map((m) => BRANDING_DEPT[m]).filter((c): c is string => c !== null),
  )];

  /**
   * ПРИЁМКА ГОТОВОГО ИЗДЕЛИЯ НА СКЛАДЕ (правки заказчика 07.09, п. 9).
   *
   * «Для типа производства „Готовое изделие“ с нанесением „на готовом“
   * добавить обязательную приёмку на складе до нанесения. Для шелкографии
   * маршрут: Склад (приёмка готового изделия) → Шелкография → ВТО → Склад →
   * Отгрузка. Сейчас заказ сразу попадает в шелкографию».
   *
   * ПОЧЕМУ ЭТО ЭТАП, А НЕ ФЛАГ-ГЕЙТ. Гейты запуска (`isStageReady`,
   * `waitingReason`) принимают признаки ПАРАМЕТРАМИ, и седьмой параметр
   * пришлось бы дописать в тринадцать мест вызова, шесть из них без тайпчека —
   * ровно тот «забытый вызывающий», из-за которого 02.09 данные разработки
   * поехали эмбедом, а сигнатуру гейта отгрузки не тронули. Приёмка,
   * выраженная этапом, гейтит сама: цех нанесения зависит от неё через
   * `depends_on`, и ни одна поверхность про это знать не обязана.
   *
   * ПОЧЕМУ ЭТО НЕ ПРОТИВОРЕЧИТ `utils/warehouseStep`. Тот шаг — КОНЕЦ
   * маршрута (упаковка и отгрузка), он принадлежит ЗАКАЗУ и считается
   * из складских задач. Здесь — НАЧАЛО: приёмка чужого товара до работы,
   * она принадлежит ПОЗИЦИИ и у каждой своя. Две разные величины.
   *
   * ЦЕХ НЕПРОИЗВОДСТВЕННЫЙ, и правило проекта требует своего экрана,
   * читающего ЭТАПЫ (`routeReachable.test.ts`, дефект 12.08 с 33 заказами):
   * его даёт вкладка «Приёмка изделия» на складе (`warehouse/FgIntakeQueue`).
   *
   * ТОЛЬКО ПРИ НАНЕСЕНИИ. Документ говорит о готовом изделии С нанесением;
   * у заказа без нанесений работать над чужим товаром некому, и обязательный
   * этап приёмки был бы новой пробкой на пустом месте.
   */
  const needsIntake = productionType === 'ready_garment' && brandingCodes.length > 0;
  const chain = needsIntake
    ? [...(BASE_CHAIN.ready_garment ?? []), WAREHOUSE_DEPT_CODE]
    : (BASE_CHAIN[productionType] ?? []);

  const stages: RouteStage[] = [];
  let sort = 10;

  // Нанесение на крое возможно только если в цепочке есть закрой
  const brandAfterCut = brandingOn === 'cut' && chain.includes('cutting');

  for (let i = 0; i < chain.length; i++) {
    const code = chain[i];
    const prev = i > 0 ? chain[i - 1] : null;
    let dependsOnCodes = prev ? [prev] : [];

    // Швейка после нанесения на крое ждёт все ветки нанесения
    if (brandAfterCut && brandingCodes.length > 0 && prev === 'cutting' ) {
      dependsOnCodes = [...brandingCodes];
    }

    stages.push({ departmentCode: code, dependsOnCodes, sortOrder: sort });
    sort += 10;

    // Вставляем ветки нанесения сразу после закроя
    if (brandAfterCut && code === 'cutting' && brandingCodes.length > 0) {
      for (const bc of brandingCodes) {
        stages.push({ departmentCode: bc, dependsOnCodes: ['cutting'], sortOrder: sort });
      }
      sort += 10;
    }
  }

  // Нанесение на готовом (или на крое без закроя в цепочке) — в конец
  if (brandingCodes.length > 0 && !brandAfterCut) {
    const last = chain.length > 0 ? chain[chain.length - 1] : null;
    for (const bc of brandingCodes) {
      stages.push({
        departmentCode: bc,
        dependsOnCodes: last ? [last] : [],
        sortOrder: sort,
      });
    }
    sort += 10;
  }

  /**
   * ВТО ПОСЛЕ НАНЕСЕНИЯ У ГОТОВОГО ИЗДЕЛИЯ (правки 07.09, п. 9).
   *
   * Документ называет маршрут дословно: «Склад (приёмка готового изделия) →
   * Шелкография → ВТО → Склад → Отгрузка». У пошива ВТО стоит в базовой
   * цепочке, у готового изделия цепочки нет вовсе — изделие приходит готовым,
   * и утюжить его надо ровно после печати.
   *
   * ЗАВИСИТ ОТ ВСЕХ ВЕТОК, как швейка после нанесения на крое: у позиции
   * бывает и шелкография, и вышивка, и ВТО, привязанное к одной из них,
   * начало бы работу, пока вторая ещё печатает.
   *
   * Только вместе с приёмкой (`needsIntake`): без нанесений печатать нечего,
   * и утюжить тоже.
   */
  if (needsIntake) {
    stages.push({
      departmentCode: VTO_DEPT_CODE,
      dependsOnCodes: [...brandingCodes],
      sortOrder: sort,
    });
    sort += 10;
  }

  /**
   * Финальный ОТК больше НЕ добавляется (правки заказчика 10.08).
   *
   * Отдельного цеха ОТК в структуре производства нет: контроль качества встроен
   * в сами производственные этапы — тот, кто сдаёт работу, за неё и отвечает.
   * Отдельный участок означал лишний переход между цехами и лишнюю пробку
   * в конце каждого маршрута.
   *
   * Живых этапов у цеха `qc` на момент правки не было ни одного, поэтому ничего
   * не переносим и не закрываем: цех деактивирован миграцией, старые маршруты
   * трогать не пришлось.
   */

  return stages;
}

/**
 * Маршрут позиции с учётом закупки: если закупать нечего — этап `supply`
 * вырезается, и его убирают из `depends_on` остальных, чтобы не осиротить
 * зависимость. Единый источник для стора (`createOrder`) и превью маршрута
 * в форме создания: раньше правило жило только в `ordersSlice`, и превью
 * разошлось бы с фактом.
 *
 * ДВА ОСНОВАНИЯ ВЫРЕЗАТЬ ЗАКУПКУ, и главное из них — новое.
 *
 * `needsPurchase = false` — менеджер отметил «Закупка не требуется» (правки
 * 20.08). Документ требует этого прямо: «сам факт наличия подряда не означает,
 * что что-то нужно покупать… закупка создаётся только тогда, когда для заказа
 * действительно требуется закупка». Раньше этап `supply` стоял в НАЧАЛЕ
 * маршрута у любого типа производства — то есть закупка заводилась всегда,
 * и заказ, где покупать нечего, всё равно ждал закупщика.
 *
 * `materialSource = 'contractor'` при подряде — прежнее частное правило.
 * Оно поглощается первым (материал подрядчика = закупать нечего), но оставлено
 * явным: у заказов, заведённых до отметки, `purchase_required` стоит `true`
 * по умолчанию, и без этой ветки им дорисовало бы закупку задним числом.
 */
export function buildItemRoute(input: BuildRouteInput & {
  materialSource?: string | null;
  /** Требуется ли закупка по заказу; не передано — считаем, что да */
  needsPurchase?: boolean;
}): RouteStage[] {
  const route = buildRoute(input);
  const contractorMaterial =
    input.productionType === 'outsource' && input.materialSource === 'contractor';
  const skipSupply = input.needsPurchase === false || contractorMaterial;
  if (!skipSupply) return route;
  return route
    .filter((r) => r.departmentCode !== 'supply')
    .map((r) => ({ ...r, dependsOnCodes: r.dependsOnCodes.filter((c) => c !== 'supply') }));
}

/**
 * Строка цеха в объёме, нужном материальному гейту. Принимаем строку, а не код:
 * какие материалы блокируют участок — настройка в данных
 * (`erp_departments.gate_material_kinds`, правится в админке), а не константа.
 * Раньше здесь была карта `MATERIAL_GATE_DEPT` с зашитыми `fabric → cutting` и
 * `hardware|labels → sewing`, и участок, заведённый директором, под гейт не попадал.
 */
export interface MaterialGateDept {
  code?: string;
  gate_material_kinds?: string[] | null;
}

/** Виды материалов, блокирующие запуск этапа этого участка (пусто = не гейтится) */
function gateKindsFor(dept: MaterialGateDept | null | undefined): string[] {
  return dept?.gate_material_kinds ?? [];
}

/**
 * Минимум материала, по которому судят о его годности. Ужать сигнатуру
 * до двух колонок понадобилось, когда правило переехало в единственное
 * место: `utils/supply.isMaterialSettled` выводится из него же, а фикстуры
 * закупки полного материала не строят.
 */
export type MaterialReadiness = Pick<ErpMaterial, 'status' | 'accept_status'>;

/** Приёмка склада завершена приёмкой (полностью/частично) — материал годен в производство */
function materialAccepted(m: MaterialReadiness): boolean {
  return m.accept_status === 'accepted_full' || m.accept_status === 'accepted_partial';
}

/**
 * Материал ещё не готов к производству (гейтит цех-потребитель).
 * «Не требуется» и «Доступен со склада» (reserved) — годны без приёмки.
 * Пришедший закупочный материал (received) годен ТОЛЬКО после приёмки складом
 * (правка 3): недостача/пересорт/отказ/непринятое — блокируют закрой.
 *
 * Экспортируется, чтобы гейт отгрузки (`isOrderReadyToShip`) судил о материалах
 * ровно по тому же правилу, что и запуск этапа: раньше отгрузка считала любой
 * `received` годным и пропускала заказ с непринятым/отказанным материалом.
 */
export function isMaterialPending(m: MaterialReadiness): boolean {
  return materialPending(m);
}

function materialPending(m: MaterialReadiness): boolean {
  if (m.status === 'not_needed' || m.status === 'reserved') return false;
  if (m.status === 'received') return !materialAccepted(m);
  return true;
}

/**
 * Материалы, относящиеся к позиции: её собственные плюс общие для заказа.
 *
 * `erp_materials.item_id` необязателен: материал, заведённый на весь заказ
 * (упаковка, бирки одного дизайна), имеет `null` и касается всех позиций.
 * Материал с проставленным `item_id` — только своей.
 *
 * Вызывать ОБЯЗАТЕЛЬНО перед материальным гейтом. Раньше в гейт уходил весь
 * `order.materials`, и задержка ткани на четвёртой позиции держала закрой первых
 * трёх: цех видел «Ждём материалы» по ткани, которая к его работе не относится.
 */
export function materialsForItem(
  materials: ErpMaterial[] | null | undefined,
  itemId?: string | null,
): ErpMaterial[] {
  const all = materials ?? [];
  if (!itemId) return all;
  return all.filter((m) => !m.item_id || m.item_id === itemId);
}

/**
 * Непришедшие материалы, которые нужны данному цеху (для гейта и причины ожидания).
 *
 * Ожидает материалы, УЖЕ отфильтрованные по позиции (`materialsForItem`): здесь
 * решается только «какой вид материала нужен какому цеху», принадлежность позиции —
 * ответственность вызывающего, потому что сам этап о своей позиции знает, а список
 * материалов приходит от заказа.
 */
export function missingMaterialsForStage(
  materials: ErpMaterial[],
  dept?: MaterialGateDept | null,
): ErpMaterial[] {
  const kinds = gateKindsFor(dept);
  if (kinds.length === 0) return [];
  return materials.filter((m) => materialPending(m) && kinds.includes(m.kind));
}

/** Блокируют ли материалы запуск этапа этого цеха */
export function materialsBlockStage(
  materials: ErpMaterial[],
  dept?: MaterialGateDept | null,
): boolean {
  return missingMaterialsForStage(materials, dept).length > 0;
}

/** Минимальная форма задачи закупки для гейта (чтобы не тянуть весь тип) */
type ProcurementGateTask = { source_stage_id: string | null; status: string };

/**
 * Ждёт ли этап закупку: есть открытая (не done/cancelled) задача закупки,
 * привязанная к этому этапу (source_stage_id). Тогда этап не запускать, пока
 * материал не закуплен и задача не закрыта (замыкает цикл производство↔закупка).
 */
/**
 * Задача дозакупки закрыта: выполнена или отменена.
 *
 * Набор слов тот же, что у задач разработки и слотов плана, но ВЕЛИЧИНА
 * другая — «закрыта ли дозакупка», а не «закрыта ли задача технолога». Свести
 * их в одну функцию значило бы обобщить по совпадению написания: у каждой
 * сущности свой предикат рядом со своими данными. А вот три копии ВНУТРИ
 * одной величины (здесь, в `hasOpenProcurement` и в `orderHelpers`) — уже дубль,
 * и он сведён сюда.
 */
export function isProcurementClosed(task: { status: string }): boolean {
  return task.status === 'done' || task.status === 'cancelled';
}

export function isStageAwaitingProcurement(
  procurementTasks: ProcurementGateTask[] | null | undefined,
  stageId: string,
): boolean {
  return (procurementTasks ?? []).some(
    (t) => t.source_stage_id === stageId && !isProcurementClosed(t),
  );
}

/**
 * Есть ли у заказа открытая задача дозакупки/замены (правка 7): любая задача
 * закупки со статусом ∉ done/cancelled. Для яркого выделения заказа и уведомлений.
 */
export function hasOpenProcurement(
  procurementTasks: ProcurementGateTask[] | null | undefined,
): boolean {
  return (procurementTasks ?? []).some((t) => !isProcurementClosed(t));
}

/**
 * Готов ли этап к работе: все зависимости done/skipped.
 * (Материальный гейт, гейт закупки и гейт ТЗ проверяются отдельно и передаются флагами.)
 *
 * `missingTz` — этапу не назначено ТЗ (`utils/tz.stageMissingTz`). Вторая ступень гейта
 * заказчика: первая — блокировка кнопки создания заказа, эта — страховка для этапов,
 * появившихся позже (перенос между цехами) и заказов, заведённых до внедрения ТЗ.
 */
export function isStageReady(
  stage: Pick<ErpItemStage, 'depends_on' | 'status'>,
  allStages: Pick<ErpItemStage, 'id' | 'status'>[],
  materials: ErpMaterial[],
  dept?: MaterialGateDept | null,
  blockedByProcurement = false,
  missingTz = false,
): boolean {
  if (blockedByProcurement) return false;
  if (missingTz) return false;
  if (materialsBlockStage(materials, dept)) return false;
  const byId = new Map(allStages.map((s) => [s.id, s]));
  return stage.depends_on.every((depId) => {
    const dep = byId.get(depId);
    return !dep || dep.status === 'done' || dep.status === 'skipped';
  });
}

/**
 * Причина ожидания этапа — человекочитаемая (как «Причина ожидания» в таблице).
 * null = не заблокирован.
 */
export function waitingReason(
  stage: Pick<ErpItemStage, 'depends_on' | 'status' | 'block_reason'>,
  allStages: Pick<ErpItemStage, 'id' | 'status' | 'department_id'>[],
  materials: ErpMaterial[],
  departmentNameById: Map<string, string>,
  dept?: MaterialGateDept | null,
  blockedByProcurement = false,
  missingTz = false,
): string | null {
  if (stage.status === 'blocked') return stage.block_reason || 'Заблокирован цехом';
  if (blockedByProcurement) return 'Ожидает закупку материала на замену';
  if (missingTz) return 'Не назначено ТЗ';
  const missing = missingMaterialsForStage(materials, dept);
  if (missing.length > 0) {
    // Пришли, но склад не принял → «ожидает приёмки»; иначе → «ждём приход»
    const awaitingAcceptance = missing.filter((m) => m.status === 'received');
    if (awaitingAcceptance.length === missing.length) {
      return `Ожидает приёмки складом: ${awaitingAcceptance.map((m) => m.name).join(', ')}`;
    }
    const parts = missing.map((m) => {
      const eta = formatDateShort(m.eta_date);
      const tail = m.status === 'received' ? ' (ожидает приёмки)' : eta ? ` (план ${eta})` : ' (план не указан)';
      return `${m.name}${tail}`;
    });
    return `Ждём материалы: ${parts.join(', ')}`;
  }
  const byId = new Map(allStages.map((s) => [s.id, s]));
  for (const depId of stage.depends_on) {
    const dep = byId.get(depId);
    if (dep && dep.status !== 'done' && dep.status !== 'skipped') {
      const name = departmentNameById.get(dep.department_id) || 'предыдущий этап';
      return `${name}: ещё не завершено`;
    }
  }
  return null;
}
