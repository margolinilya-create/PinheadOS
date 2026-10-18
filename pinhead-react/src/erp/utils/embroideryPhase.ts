/**
 * ВЫШИВКА ОДНОЙ ЗАДАЧЕЙ (правки 19.10, п. 1; решения Р1–Р4).
 *
 * «Сразу после заведения заказа с вышивкой в ERP создавать в цехе вышивки
 * одну задачу „Разработка программы вышивки“… После завершения разработки
 * программы эта же задача превращается в задачу „Вышивка“. Отдельную вторую
 * задачу не создавать. История работы и файлы программы сохраняются в этой
 * задаче».
 *
 * Строка одна и проходит две фазы; фаза — колонка `result_kind`:
 *   · `embroidery_program` — «Разработка программы вышивки». Не ждёт ни
 *     маршрута, ни материалов (Р2) и «непрозрачна» (Р3): количество дальше
 *     не пропускает, закрыть или пропустить её нельзя — только «Программа
 *     готова» (`erp_embroidery_program_finish`) или «Без программы»
 *     (`erp_embroidery_program_skip`, `order.manage`).
 *   · `null` — «Вышивка». Ждёт `depends_on` строки — маршрут конкретного
 *     заказа (крой или последний этап цепочки).
 *
 * ФАЗА ЕСТЬ ТОЛЬКО У ОДИНОЧНОЙ СТРОКИ (Р1): у позиции нет другой строки того
 * же цеха без `result_kind`. Заказы до 19.10 с парой строк (отдельная
 * программа + вышивка) живут по прежним правилам (`embroideryProgramBlock`).
 * Закрытая программа — тоже наследие: фазой не считается.
 *
 * Зеркало серверной `erp_embroidery_is_phased`. Модуль-лист: его читают
 * утилиты маршрута (`routes`, `stageInput`, `progress`, `gantt`), гейты стора
 * и экраны цеха, поэтому здесь нет импортов кроме типов.
 */
import type { ErpItemStage } from '../types';

/** Имя операции фазы программы — подпись задачи в очереди цеха */
export const EMBROIDERY_PROGRAM_OPERATION = 'Разработка программы вышивки';

/**
 * Почему фазу программы нельзя закрыть, пропустить или сдать штуками.
 * Текст тот же, что у сервера (`erp_item_stages_embroidery_route_gate`).
 */
export const PROGRAM_PHASE_BLOCK = 'Сначала сдайте программу — задача станет «Вышивкой»';

/** Строка, о которой спрашивают «в фазе ли программы» */
export type PhaseStage = Pick<ErpItemStage, 'id' | 'department_id'> & {
  item_id?: string | null;
  result_kind?: string | null;
  status?: string | null;
};

/** Соседняя строка позиции */
export type PhaseSibling = Pick<ErpItemStage, 'id' | 'department_id'> & {
  item_id?: string | null;
  result_kind?: string | null;
};

/**
 * Строка вышивки в фазе «Разработка программы».
 *
 * `siblings` — этапы позиции (у всех вызывающих это `item.stages`). Строка
 * другой позиции фазу не снимает: сравнение по `item_id`, когда он есть
 * у обеих строк.
 */
export function isProgramPhase(
  stage: PhaseStage | null | undefined,
  siblings: readonly PhaseSibling[] | null | undefined,
): boolean {
  if (!stage || stage.result_kind !== 'embroidery_program') return false;
  if (stage.status === 'done' || stage.status === 'skipped') return false;
  return !(siblings ?? []).some((s) => s.id !== stage.id
    && s.department_id === stage.department_id
    && !s.result_kind
    && !(s.item_id && stage.item_id && s.item_id !== stage.item_id));
}

/**
 * Операция для подписи задачи, или `null` — тогда задача зовётся цехом.
 *
 * Сервер при переходе стирает операцию, но строка, прочитанная раньше или
 * правленная в конструкторе маршрута, может нести старое «Разработка
 * программы вышивки» при пустом `result_kind`. В фазе вышивки эта подпись
 * была бы неправдой: задача — «Вышивка».
 */
export function phaseOperation(
  stage: { operation?: string | null; result_kind?: string | null },
): string | null {
  const op = stage.operation?.trim() || null;
  // Строго `null`: строка из узкого select без колонки (`undefined`) фазу
  // не знает, и подпись остаётся как есть
  if (op === EMBROIDERY_PROGRAM_OPERATION && stage.result_kind === null) return null;
  return op;
}

/**
 * id заголовка задачи — цель фокуса после перехода фазы: панель действий
 * меняется целиком («Программа готова» исчезает), и фокус, оставшийся
 * на пропавшей кнопке, улетел бы в начало страницы.
 */
export function stageHeadingId(stageId: string): string {
  return `stage-title-${stageId}`;
}
