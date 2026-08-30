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
  | 'same'
  /** Закупка не завершена — с лекал дальше нельзя (правка 30.08, п. 1) */
  | 'materials';

export interface DevMoveInput {
  from: DevStage;
  to: unknown;
  /** Исход разработки: непусто — она закрыта */
  outcome?: string | null;
  /** `experimental.manage` у текущего человека */
  canManage: boolean;
  /**
   * Материалы позиции не приехали (тот же расчёт, что у гейта кроя —
   * `cuttingGate(...).wait` про материалы). Считается ВНЕ функции, чтобы
   * правило «материал годен» осталось одним на весь раздел, а не появилось
   * второй копией здесь.
   */
  materialsPending?: boolean;
}

export type DevMoveResult =
  | { ok: true; to: DevStage }
  | { ok: false; reason: DevMoveRefusal };

/**
 * Порядок проверок — от самого общего запрета к частному, чтобы отказ называл
 * ГЛАВНУЮ причину: человеку без права незачем читать «карточка уже здесь».
 */
export function devMoveIntent(input: DevMoveInput): DevMoveResult {
  const { from, to, outcome, canManage, materialsPending } = input;
  if (!canManage) return { ok: false, reason: 'forbidden' };
  if (outcome) return { ok: false, reason: 'closed' };
  if (!isStage(to)) return { ok: false, reason: 'same' };
  if (to === from) return { ok: false, reason: 'same' };
  /**
   * ЗАКУПКА ДЕРЖИТ ВЫХОД С ЛЕКАЛ (правка заказчика 30.08, п. 1).
   *
   * Блокируется именно ВЫХОД, а не сам этап: документ прямо требует, чтобы
   * построение лекал шло ПАРАЛЛЕЛЬНО закупке — это «текущая правильная
   * логика, её нужно сохранить». Запрет на вход в `patterns` сломал бы
   * ровно то, что просили не трогать.
   *
   * Назад двигать можно всегда: человек, ошибшийся колонкой, обязан иметь
   * возможность откатиться, а материалов это не касается.
   */
  if (from === 'patterns' && materialsPending && isForward(from, to)) {
    return { ok: false, reason: 'materials' };
  }
  return { ok: true, to };
}

/** Вперёд ли по маршруту разработки */
function isForward(from: DevStage, to: DevStage): boolean {
  return DEV_STAGE_ORDER.indexOf(to) > DEV_STAGE_ORDER.indexOf(from);
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
 * ЧТО СПРОСИТЬ ПРИ ПЕРЕХОДЕ (правка заказчика 30.08, п. 3).
 *
 * Обязательных задач у этапов маршрута больше нет, а вместе с ними исчезло
 * и место, где спрашивалось техническое название лекал: раньше его требовало
 * ЗАКРЫТИЕ ЗАДАЧИ `patterns`. Документ переносит вопрос в сам переход
 * «Построение лекал → Крой» и требует ОДНОГО окна: «Отдельный ввод свободного
 * текста „Результат этапа" не показывать».
 *
 * Правило живёт здесь, рядом с `devMoveIntent`, а не в обработчике доски:
 * у переноса уже два входа — перетаскивание и кнопки «‹ ›», — и оба обязаны
 * спрашивать одно и то же. Сегодня оба ведут в один обработчик
 * (`Experimental.moveDevStage`), и это единственное место переноса: карточка
 * разработки маршрут только ПОКАЗЫВАЕТ. Появится второй писатель колонки —
 * он позовёт эту же функцию, а не заведёт своё условие.
 *
 * Второй путь к тому же полю остаётся у ручной задачи `patterns`
 * (`DevCard.updateTask`): её никто не создаёт автоматически, но технолог
 * вправе завести её сам, и её закрытие пишет ту же колонку.
 *
 * `null` — переход не требует ввода.
 */
export interface DevMovePrompt {
  /** Куда пишется значение — поле `erp_experimental` */
  field: 'pattern_tech_name';
  title: string;
  label: string;
  /** Уже записанное значение: повторно требовать его незачем */
  initialValue: string;
}

export function devMovePrompt(
  from: DevStage,
  to: DevStage,
  dev: { pattern_tech_name?: string | null },
): DevMovePrompt | null {
  if (from !== 'patterns' || to !== 'cutting') return null;
  if (dev.pattern_tech_name) return null;
  return {
    field: 'pattern_tech_name',
    title: 'Завершить построение лекал',
    label: 'Техническое название лекал',
    initialValue: '',
  };
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
  materials: 'Ожидаем материал: закупка ещё не завершена. '
    + 'Лекала можно строить параллельно, а дальше карточка пойдёт после приёмки складом.',
};
