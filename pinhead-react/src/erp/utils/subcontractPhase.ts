/**
 * Фаза подряда — единственная величина, которой клиент двигает подрядную операцию.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Волна 3.5 завела `erp_subcontracting.phase`, перевела на неё
 * складской гейт (`sc.phase not in ('accepted','closed')`) и описала семь фаз
 * документа — но КЛИЕНТ остался на устаревшей колонке `status`. В результате
 * `phase` выставлялась бэкфиллом ровно один раз и с тех пор не двигалась:
 * гейт читал колонку, которую никто не продвигает, а экран подряда продолжал
 * писать `awaiting_payment` — тот самый статус, который волна 3.5 объявила
 * убранным из производственного потока.
 *
 * Ошибка этого рода не падает: обе колонки «работают», просто описывают разное.
 * Поэтому маппинг живёт ОДНОЙ функцией с тестами, а не рассыпан по экрану.
 *
 * ЧТО ТЕПЕРЬ ГДЕ:
 *   · `phase`  — производственная фаза. Её пишет и читает клиент, её читает гейт.
 *   · `status` — устаревшая колонка. Клиент её больше не читает, но ПИШЕТ
 *     зеркалом (`legacyStatusFromPhase`), потому что колонка `not null` и
 *     оставить её врать нельзя. Ровно один писатель и ровно одно выражение —
 *     иначе это опять два источника правды. Снимется отдельной миграцией.
 *   · `payment_status` — финансовый признак, в переходах не участвует.
 */

import type { SubcontractPhase, SubcontractStatus } from '../types';

/**
 * Порядок фаз. Один и тот же для готового изделия и для отдельной операции:
 * документ требует, чтобы подряд вёл себя как обычный этап, а этап не меняет
 * набор состояний от того, что именно в нём делают. Различаются не фазы,
 * а последствия перехода (см. applySubcontractTransition).
 */
export const SUBCONTRACT_PHASE_FLOW: SubcontractPhase[] = [
  'planned', 'materials_ready', 'sent', 'at_contractor', 'ready_at_contractor',
  'returned', 'accepted', 'closed',
];

/**
 * Фазы, в которых работа физически у подрядчика и ещё чего-то ждёт.
 * Отсюда считается бейдж «Подряд» и просрочка: вернувшаяся операция подрядчика
 * уже не задерживает — дальше вопрос к складу, а не к контрагенту.
 */
export const SUBCONTRACT_TERMINAL_PHASES: SubcontractPhase[] = ['returned', 'accepted', 'closed'];

export function isSubcontractTerminal(phase: SubcontractPhase): boolean {
  return SUBCONTRACT_TERMINAL_PHASES.includes(phase);
}

/**
 * Устаревший статус → фаза. Дословное зеркало бэкфилла миграции
 * 20260810210000, ПЛЮС две ветки, которых там не было:
 *
 *   · `awaiting_materials` в миграции проваливался в `else 'planned'` —
 *     живых строк с ним не было, поэтому промах ничего не испортил, но
 *     повторять его здесь незачем: это ровно `materials_ready`;
 *   · `delayed` — задержка не отменяет того, что вещь у подрядчика.
 *
 * Нужна для чтения строк, созданных до этой правки: у них `phase` стоит
 * с бэкфилла, а осмысленное значение лежит в `status`.
 */
export function phaseFromLegacyStatus(status: string | null | undefined): SubcontractPhase {
  switch (status) {
    case 'planned': return 'planned';
    case 'awaiting_payment': return 'planned';
    case 'awaiting_materials': return 'materials_ready';
    case 'sent': return 'sent';
    case 'in_progress': return 'at_contractor';
    case 'started': return 'at_contractor';
    case 'ready_to_ship': return 'at_contractor';
    case 'delayed': return 'at_contractor';
    case 'shipped_by_contractor': return 'returned';
    case 'returned': return 'returned';
    case 'received_at_pinhead': return 'accepted';
    case 'cancelled': return 'closed';
    default: return 'planned';
  }
}

/**
 * Фаза → устаревший статус. Зеркало для совместимости: колонка `status`
 * объявлена `not null`, и новая строка без неё получила бы дефолт `'planned'`
 * навсегда — колонку, полную неправды.
 *
 * Маппинг ОДИН на оба типа операции. Соблазн развести их велик (у готового
 * изделия был свой поток `started`/`ready_to_ship`/`shipped_by_contractor`), но
 * CHECK на `status` про `op_type` ничего не знает, а две таблицы перевода
 * означали бы, что часть фаз схлопывается только для одного типа — то есть
 * поведение зеркала зависит от того, чем именно занят подрядчик. Проверено
 * тестом: круговой прогон держится для шести фаз из семи.
 *
 * СХЛОПЫВАНИЙ РОВНО ДВА, и оба вынуждены перечислением `status`:
 *   · `closed` — значения `closed` в нём нет вовсе, закрытая операция
 *     зеркалится как принятая; ни одно старое чтение их не различает;
 *   · `ready_at_contractor` — восьмая фаза документа, заведённая правкой 16.08.
 *     Ближайшее по смыслу `ready_to_ship` в бэкфилле миграции уже занято
 *     под `at_contractor`, и перевесить его нельзя: тот маппинг сторожит тест,
 *     читающий саму миграцию, а перевес поменял бы чтение уже существующих
 *     строк. Поэтому обратный ход даёт `at_contractor` — потеря ровно в том
 *     месте, где старая колонка и не умела различать эти два состояния.
 */
export function legacyStatusFromPhase(phase: SubcontractPhase): SubcontractStatus {
  switch (phase) {
    case 'planned': return 'planned';
    case 'materials_ready': return 'awaiting_materials';
    case 'sent': return 'sent';
    case 'at_contractor': return 'in_progress';
    case 'ready_at_contractor': return 'ready_to_ship';
    case 'returned': return 'returned';
    case 'accepted': return 'received_at_pinhead';
    case 'closed': return 'received_at_pinhead';
    default: return 'planned';
  }
}

/**
 * Фаза операции. Строки, созданные до этой правки, несут осмысленное значение
 * в `status`, а `phase` у них с бэкфилла — поэтому «фаза не двигалась от
 * начальной, а статус ушёл вперёд» читается как «верить статусу».
 *
 * Дальше первой фазы это правило не действует: после правки авторитетна `phase`.
 */
export function subcontractPhase(
  op: { phase?: string | null; status?: string | null },
): SubcontractPhase {
  const phase = op.phase as SubcontractPhase | undefined | null;
  if (phase && phase !== 'planned') return phase;
  const fromStatus = phaseFromLegacyStatus(op.status);
  return phase && fromStatus === 'planned' ? phase : fromStatus;
}

/** Следующая фаза по порядку; null — дальше некуда */
export function nextSubcontractPhase(phase: SubcontractPhase): SubcontractPhase | null {
  const idx = SUBCONTRACT_PHASE_FLOW.indexOf(phase);
  if (idx === -1) return SUBCONTRACT_PHASE_FLOW[0];
  return SUBCONTRACT_PHASE_FLOW[idx + 1] ?? null;
}

/**
 * Патч перехода: фаза плюс зеркало устаревшей колонки. Единственное место,
 * где `status` пишется — поэтому «двух писателей одной колонки» здесь нет.
 */
export function subcontractPhasePatch(
  phase: SubcontractPhase,
): { phase: SubcontractPhase; status: SubcontractStatus } {
  return { phase, status: legacyStatusFromPhase(phase) };
}
