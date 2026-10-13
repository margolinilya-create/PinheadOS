import type { BypassKind, ErpBypass } from '../types';

/**
 * Аварийно снятые блокировки — одно место, где решается «действует ли гейт».
 *
 * Заказчик просил механику на случай, когда обязательная проверка из-за бага
 * останавливает работу целиком. Соблазн — расставить условия по местам, где гейты
 * применяются (их девять), но тогда через месяц половина мест будет знать про
 * снятие, а половина нет, и объяснить человеку, почему один экран пускает,
 * а другой нет, станет нечем.
 *
 * Поэтому здесь только чистые функции над списком, а сам список живёт в сторе.
 */

/** Снятие действует, пока проверку не вернули */
export function isActiveBypass(b: Pick<ErpBypass, 'restored_at'>): boolean {
  return b.restored_at === null;
}

export function activeBypasses(bypasses: ErpBypass[]): ErpBypass[] {
  return bypasses.filter(isActiveBypass);
}

/**
 * Снята ли проверка для этого заказа.
 *
 * Глобальное снятие (`order_id = null`) действует на все заказы; снятие по заказу —
 * только на свой. Обратного («глобально снято, но для заказа X вернуть») намеренно
 * нет: это уже режим правил, а не аварийный выход, и человеку пришлось бы держать
 * в голове пересечение двух списков.
 */
export function isBypassed(
  kind: BypassKind,
  orderId: string | null | undefined,
  bypasses: ErpBypass[] | null | undefined,
): boolean {
  if (!bypasses || bypasses.length === 0) return false;
  return bypasses.some((b) => (
    isActiveBypass(b)
    && b.kind === kind
    && (b.order_id === null || (orderId != null && b.order_id === orderId))
  ));
}

/**
 * Активное снятие для показа человеку: кто снял и зачем.
 *
 * Возвращаем именно запись, а не булево: рядом с заданием показывается причина —
 * без неё пометка «проверка снята» вызывает больше вопросов, чем снимает.
 * При двух подходящих (глобальное и по заказу) берём более узкое: оно точнее
 * объясняет, почему запустился именно этот заказ.
 */
export function bypassFor(
  kind: BypassKind,
  orderId: string | null | undefined,
  bypasses: ErpBypass[] | null | undefined,
): ErpBypass | null {
  if (!bypasses || bypasses.length === 0) return null;
  const matching = bypasses.filter((b) => (
    isActiveBypass(b)
    && b.kind === kind
    && (b.order_id === null || (orderId != null && b.order_id === orderId))
  ));
  if (matching.length === 0) return null;
  return matching.find((b) => b.order_id !== null) ?? matching[0];
}

/**
 * Материалы, которые гейт больше не держит.
 *
 * Гейты принимают список материалов параметром (`isStageReady`, `waitingReason`),
 * поэтому снятая проверка выражается пустым списком — без единой новой ветки
 * внутри самих функций и без седьмого позиционного аргумента у них.
 */
export function materialsAfterBypass<T>(
  materials: T[],
  orderId: string | null | undefined,
  bypasses: ErpBypass[] | null | undefined,
): T[] {
  return isBypassed('material_gate', orderId, bypasses) ? [] : materials;
}
