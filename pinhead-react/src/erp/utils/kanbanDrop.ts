/**
 * Смысл броска карточки на канбане — чистая логика, покрыта тестами.
 *
 * Раньше решение было размазано по двум обработчикам `ErpKanban`, и порядок
 * drop-событий его ломал: дорожка получает `drop` первой и всплывает в колонку.
 * Обработчик дорожки успевал вызвать `onDragEnd()` (он обнуляет `dragRef`), и колонка
 * читала уже `null` — перенос в другой цех молча не срабатывал нигде, кроме шапки
 * колонки (~40px из всей её высоты). Теперь дорожка спрашивает намерение до того,
 * как что-либо трогает, и на `transfer` отдаёт событие колонке нетронутым.
 */

/** Куда карточку можно уронить внутри своей колонки (переход по статусу) */
export const ALLOWED_LANE_DROP: Record<string, string[]> = {
  ready: ['in_progress'],
  in_progress: ['done'],
};

export type KanbanDropIntent =
  /** Другой цех — перенос задания (обрабатывает колонка) */
  | 'transfer'
  /** Свой цех, есть место вставки — смена приоритета в очереди */
  | 'reorder'
  /** Свой цех, разрешённый переход по статусу */
  | 'status'
  /** Бросок ничего не значит */
  | 'none';

export interface KanbanDropInput {
  /** Цех перетаскиваемого задания */
  draggedDeptId: string;
  /** Группа перетаскиваемого задания: ready | in_progress | done | blocked */
  draggedGroup: string;
  /** Цех дорожки, на которую бросили */
  targetDeptId: string;
  /** Дорожка, на которую бросили: ready | in_progress | done */
  targetLane: string;
  /** Курсор стоял над карточкой той же дорожки (есть место вставки) */
  hasInsertPoint: boolean;
}

/**
 * Порядок проверок важен: «чужой цех» решается ДО всего остального, иначе
 * дорожка чужой колонки заберёт бросок себе и перенос потеряется.
 */
export function kanbanDropIntent(input: KanbanDropInput): KanbanDropIntent {
  const { draggedDeptId, draggedGroup, targetDeptId, targetLane, hasInsertPoint } = input;

  if (draggedDeptId !== targetDeptId) return 'transfer';
  if (hasInsertPoint) return 'reorder';
  if ((ALLOWED_LANE_DROP[draggedGroup] ?? []).includes(targetLane)) return 'status';
  return 'none';
}
