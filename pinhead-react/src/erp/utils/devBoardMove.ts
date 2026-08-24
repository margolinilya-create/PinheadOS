import { DEV_STAGE_LABELS, DEV_STAGE_ORDER } from './experimentalBoard';
import type { DevStage } from './experimentalBoard';

/**
 * Перенос карточки между колонками канбана ЭКС — чистая логика
 * (правка заказчика 24.08, п. 4.2).
 *
 * Отдельный модуль по той же причине, что `kanbanDrop` у общего борда:
 * решение «что означает бросок» размазанное по обработчикам однажды уже
 * ломалось порядком drop-событий, и перенос молча не срабатывал. Здесь
 * вопросов два — можно ли двигать эту карточку и куда именно, — и оба
 * задаются ещё и клавиатурой, то есть у логики два вызывающих с самого
 * начала.
 */

export type DevMoveRefusal =
  /** Разработка закрыта: колонка «Финальный этап» ей положена по исходу */
  | 'closed'
  /** Нет права вести разработку */
  | 'forbidden'
  /** Бросили туда же, откуда взяли */
  | 'same';

export interface DevMoveInput {
  from: DevStage;
  to: unknown;
  /** Исход разработки: непусто — она закрыта */
  outcome?: string | null;
  /** `experimental.manage` у текущего человека */
  canManage: boolean;
}

export type DevMoveResult =
  | { ok: true; to: DevStage }
  | { ok: false; reason: DevMoveRefusal };

/**
 * Порядок проверок — от самого общего запрета к частному, чтобы отказ называл
 * ГЛАВНУЮ причину: человеку без права незачем читать «карточка уже здесь».
 */
export function devMoveIntent(input: DevMoveInput): DevMoveResult {
  const { from, to, outcome, canManage } = input;
  if (!canManage) return { ok: false, reason: 'forbidden' };
  if (outcome) return { ok: false, reason: 'closed' };
  if (!isStage(to)) return { ok: false, reason: 'same' };
  if (to === from) return { ok: false, reason: 'same' };
  return { ok: true, to };
}

function isStage(value: unknown): value is DevStage {
  return typeof value === 'string' && (DEV_STAGE_ORDER as string[]).includes(value);
}

/**
 * Соседний шаг для клавиатурного переноса.
 *
 * КЛАВИАТУРНАЯ АЛЬТЕРНАТИВА ПЕРЕТАСКИВАНИЮ ОБЯЗАТЕЛЬНА (правило проекта),
 * и она же — единственный способ двигать карточку на планшете точно: палец
 * задевает соседние колонки при прокрутке. Возврат `null` на краю списка
 * означает «дальше некуда» — кнопку в этот момент гасят, а не показывают
 * действие, которое ничего не делает.
 */
export function neighbourStage(stage: DevStage, dir: -1 | 1): DevStage | null {
  const i = DEV_STAGE_ORDER.indexOf(stage);
  const next = DEV_STAGE_ORDER[i + dir];
  return next ?? null;
}

/** Подпись действия переноса — для `aria-label` и подтверждений */
export function devMoveLabel(to: DevStage): string {
  return `Перенести в «${DEV_STAGE_LABELS[to]}»`;
}

/**
 * Объяснение отказа. Текст живёт рядом с причиной, а не в компоненте:
 * доска и карточка разработки спрашивают одно и то же, и вторая формулировка
 * разошлась бы с первой в первую же правку.
 */
export const DEV_MOVE_REFUSAL_TEXT: Record<DevMoveRefusal, string> = {
  closed: 'Разработка закрыта — её колонка определяется исходом.',
  forbidden: 'Нужно право «Разработка образцов», чтобы двигать карточки.',
  same: 'Карточка уже в этой колонке.',
};
