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
  // experimental вынесен в отдельный модуль «Эксперим. цех» (правка 6) — не этап позиции
  samples: ['supply', 'cutting', 'sewing', 'vto'],
  outsource: ['supply'],
};

/** Метод нанесения → код цеха (null = отдельного цеха нет) */
const BRANDING_DEPT: Record<BrandingMethod, string | null> = {
  embroidery: 'embroidery',
  silkscreen: 'silkscreen',
  dtf: 'dtf',
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

  const chain = BASE_CHAIN[productionType] ?? [];
  const brandingCodes = [...new Set(
    brandingMethods.map((m) => BRANDING_DEPT[m]).filter((c): c is string => c !== null),
  )];

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
 * Маршрут позиции с учётом подряда: если материал даёт подрядчик, закупку не заводим —
 * этап supply вырезается, и его убирают из depends_on остальных, чтобы не осиротить
 * зависимость. Единый источник для стора (createOrder) и превью маршрута в форме
 * создания: раньше правило жило только в ordersSlice, и превью разошлось бы с фактом.
 */
export function buildItemRoute(input: BuildRouteInput & {
  materialSource?: string | null;
}): RouteStage[] {
  const route = buildRoute(input);
  if (input.productionType !== 'outsource' || input.materialSource !== 'contractor') return route;
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

/** Приёмка склада завершена приёмкой (полностью/частично) — материал годен в производство */
function materialAccepted(m: ErpMaterial): boolean {
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
export function isMaterialPending(m: ErpMaterial): boolean {
  return materialPending(m);
}

function materialPending(m: ErpMaterial): boolean {
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
export function isStageAwaitingProcurement(
  procurementTasks: ProcurementGateTask[] | null | undefined,
  stageId: string,
): boolean {
  return (procurementTasks ?? []).some(
    (t) => t.source_stage_id === stageId && t.status !== 'done' && t.status !== 'cancelled',
  );
}

/**
 * Есть ли у заказа открытая задача дозакупки/замены (правка 7): любая задача
 * закупки со статусом ∉ done/cancelled. Для яркого выделения заказа и уведомлений.
 */
export function hasOpenProcurement(
  procurementTasks: ProcurementGateTask[] | null | undefined,
): boolean {
  return (procurementTasks ?? []).some((t) => t.status !== 'done' && t.status !== 'cancelled');
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
