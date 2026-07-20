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
  }

  return stages;
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
 */
function materialPending(m: ErpMaterial): boolean {
  if (m.status === 'not_needed' || m.status === 'reserved') return false;
  if (m.status === 'received') return !materialAccepted(m);
  return true;
}

/** Непришедшие материалы, которые нужны данному цеху (для гейта и причины ожидания) */
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
 * (Материальный гейт и гейт закупки проверяются отдельно.)
 */
export function isStageReady(
  stage: Pick<ErpItemStage, 'depends_on' | 'status'>,
  allStages: Pick<ErpItemStage, 'id' | 'status'>[],
  materials: ErpMaterial[],
  departmentCode?: string,
  blockedByProcurement = false,
): boolean {
  if (blockedByProcurement) return false;
  if (materialsBlockStage(materials, departmentCode)) return false;
  const byId = new Map(allStages.map((s) => [s.id, s]));
  return stage.depends_on.every((depId) => {
    const dep = byId.get(depId);
    return !dep || dep.status === 'done' || dep.status === 'skipped';
  });
}

/** @deprecated Блокируют ли материалы закрой — используйте materialsBlockStage(materials, 'cutting') */
export function materialsBlockCutting(materials: ErpMaterial[]): boolean {
  return materialsBlockStage(materials, 'cutting');
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
): string | null {
  if (stage.status === 'blocked') return stage.block_reason || 'Заблокирован цехом';
  if (blockedByProcurement) return 'Ожидает закупку материала на замену';
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
