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
  MaterialKind,
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
 * Код цеха ОТК. Финальный контроль ставится последним этапом производственного
 * маршрута: он должен ждать ВСЕ терминальные этапы, потому что нанесения —
 * параллельные ветки, и «после последнего по списку» пустило бы ОТК раньше,
 * чем закончилась соседняя ветка.
 */
export const QC_DEPT_CODE = 'qc';

export interface BuildRouteInput {
  productionType: ProductionType;
  brandingMethods: BrandingMethod[];
  brandingOn: BrandingOn;
  /**
   * Нужен ли финальный ОТК. По умолчанию да — контроль качества штатный этап,
   * но менеджер снимает галочку на заказе, где он не нужен (образцы, срочная
   * отгрузка). Флаг живёт только в форме: маршрут материализуется в
   * `erp_item_stages` при создании, хранить его в позиции незачем.
   */
  needsQc?: boolean;
}

/**
 * Этапы, от которых никто не зависит — «хвосты» маршрута.
 * Их может быть несколько: нанесение на готовом даёт параллельные ветки.
 */
function terminalCodes(stages: RouteStage[]): string[] {
  const depended = new Set(stages.flatMap((s) => s.dependsOnCodes));
  return stages.filter((s) => !depended.has(s.departmentCode)).map((s) => s.departmentCode);
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

  // Финальный ОТК — только если в маршруте есть что контролировать: закупка
  // сама по себе (готовое изделие без нанесений, подряд «под ключ») своего
  // производственного этапа не даёт, и ОТК стал бы вечной пробкой на пустом месте.
  const needsQc = input.needsQc ?? true;
  const hasProduction = stages.some((s) => s.departmentCode !== 'supply');
  if (needsQc && hasProduction) {
    stages.push({
      departmentCode: QC_DEPT_CODE,
      dependsOnCodes: terminalCodes(stages),
      sortOrder: sort,
    });
  }

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
 * Какой тип материала нужен какому цеху — гейт запуска этапа.
 * Этап блокируется только своими материалами (а не всеми материалами заказа):
 *  - ткань нужна закрою; фурнитура и бирки — швейке.
 *  - упаковка и «прочее» этапы не гейтят (упаковка — на уровне заказа).
 * Карта централизована — легко расширить под новые цеха/типы.
 */
const MATERIAL_GATE_DEPT: Record<MaterialKind, string[]> = {
  fabric: ['cutting'],
  hardware: ['sewing'],
  labels: ['sewing'],
  packaging: [],
  other: [],
};

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
  departmentCode?: string,
): ErpMaterial[] {
  if (!departmentCode) return [];
  return materials.filter(
    (m) => materialPending(m) && (MATERIAL_GATE_DEPT[m.kind] ?? []).includes(departmentCode),
  );
}

/** Блокируют ли материалы запуск этапа этого цеха */
export function materialsBlockStage(materials: ErpMaterial[], departmentCode?: string): boolean {
  return missingMaterialsForStage(materials, departmentCode).length > 0;
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
  departmentCode?: string,
  blockedByProcurement = false,
  missingTz = false,
): boolean {
  if (blockedByProcurement) return false;
  if (missingTz) return false;
  if (materialsBlockStage(materials, departmentCode)) return false;
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
  departmentCode?: string,
  blockedByProcurement = false,
  missingTz = false,
): string | null {
  if (stage.status === 'blocked') return stage.block_reason || 'Заблокирован цехом';
  if (blockedByProcurement) return 'Ожидает закупку материала на замену';
  if (missingTz) return 'Не назначено ТЗ';
  const missing = missingMaterialsForStage(materials, departmentCode);
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
