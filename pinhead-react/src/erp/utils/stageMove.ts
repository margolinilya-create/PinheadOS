/**
 * Перенос задания между цехами на канбане — правила и последствия (правка «Канбан
 * и перемещение между процессами»). Чистая логика, покрыта тестами; UI из неё строит
 * текст подтверждения, стор — патчи этапов.
 *
 * Модель этапов — граф «позиция × цех × ЦИКЛ» с unique(item_id, department_id, cycle),
 * поэтому «перенести в другой цех» не значит переставить строку: это закрыть текущий
 * этап и открыть этап целевого цеха в ТОМ ЖЕ круге. Отсюда и предупреждения —
 * заказчик просил не помечать предыдущий этап завершённым молча.
 *
 * `cycle` в ключе появился 10.08 (миграция 20260810180000) вместе с образцами:
 * позиция ходит в один цех многократно. Здесь же остался поиск по паре
 * «позиция + цех» — и заголовок файла продолжал ссылаться на снятый констрейнт.
 * Сервер (`erp_stage_move_department`) ищет цель ИНАЧЕ, с `cycle = v_stage.cycle`,
 * и на образцах два поиска расходились: клиент показывал «этап существует, будет
 * переоткрыт», а сервер заводил новую строку; при двух кругах в целевом цехе
 * `find` брал первый попавшийся, отчего врали и `blocked_target`, и `back`,
 * и список пропускаемых этапов, и `queue_position`.
 */

import type { ErpItemStage } from '../types';

export type MoveIssueKind =
  | 'blocked_source'   // текущий этап заблокирован — перенос запрещён
  | 'blocked_target'   // целевой этап заблокирован — перенос запрещён
  | 'same_dept'        // перенос в тот же цех — делать нечего
  | 'new_stage'        // в маршруте позиции нет этапа целевого цеха
  | 'skip'             // между текущим и целевым остаются незакрытые этапы
  | 'back'             // возврат на более ранний этап маршрута
  | 'unfinished';      // на текущем этапе сделано не всё

export interface MoveIssue {
  kind: MoveIssueKind;
  /** Готовая формулировка последствия для диалога подтверждения */
  text: string;
}

export interface StageMovePlan {
  /** Разрешён ли перенос вообще */
  allowed: boolean;
  /** Этап целевого цеха, если он есть в маршруте позиции */
  targetStage: ErpItemStage | null;
  /** Нужен ли обязательный комментарий (возврат назад или пропуск этапов) */
  requiresComment: boolean;
  issues: MoveIssue[];
}

interface AnalyzeInput {
  stage: Pick<ErpItemStage, 'id' | 'department_id' | 'status' | 'sort_order'> & {
    qty_done?: number | null;
    /**
     * Круг образца. Необязателен: на канбан приходят и урезанные объекты
     * этапа, а у серийных строк круг всегда 0 — отсутствие поля читается
     * как нулевой круг, что совпадает с DEFAULT колонки.
     */
    cycle?: number | null;
  };
  item: { qty: number; stages: ErpItemStage[] };
  targetDeptId: string;
  targetDeptName: string;
  /** id цеха → короткое имя, для перечисления пропускаемых этапов */
  deptNameById: Map<string, string>;
}

/** Что произойдёт при переносе задания в другой цех и можно ли это делать */
export function analyzeStageMove(input: AnalyzeInput): StageMovePlan {
  const { stage, item, targetDeptId, targetDeptName, deptNameById } = input;
  const issues: MoveIssue[] = [];

  if (stage.department_id === targetDeptId) {
    return {
      allowed: false,
      targetStage: null,
      requiresComment: false,
      issues: [{ kind: 'same_dept', text: 'Задание уже в этом цехе.' }],
    };
  }

  if (stage.status === 'blocked') {
    return {
      allowed: false,
      targetStage: null,
      requiresComment: false,
      issues: [{
        kind: 'blocked_source',
        text: 'Задание заблокировано — снимите блокировку, потом переносите.',
      }],
    };
  }

  // Цель ищется в ТОМ ЖЕ круге, что и переносимый этап, — дословно как на сервере
  const targetStage = item.stages.find(
    (s) => s.department_id === targetDeptId && (s.cycle ?? 0) === (stage.cycle ?? 0),
  ) ?? null;

  if (targetStage?.status === 'blocked') {
    return {
      allowed: false,
      targetStage,
      requiresComment: false,
      issues: [{
        kind: 'blocked_target',
        text: `Этап «${targetDeptName}» заблокирован — снимите блокировку, потом переносите.`,
      }],
    };
  }

  if (!targetStage) {
    issues.push({
      kind: 'new_stage',
      text: `В маршруте позиции нет этапа «${targetDeptName}» — он будет добавлен в маршрут.`,
    });
  } else if (targetStage.sort_order < stage.sort_order) {
    issues.push({
      kind: 'back',
      text: `Это возврат на предыдущий этап маршрута — «${targetDeptName}» уже пройден по порядку.`,
    });
  } else {
    // Движение вперёд: что остаётся незакрытым между текущим и целевым этапом
    const skipped = item.stages
      .filter((s) =>
        s.sort_order > stage.sort_order &&
        s.sort_order < targetStage.sort_order &&
        s.status !== 'done' &&
        s.status !== 'skipped')
      .map((s) => deptNameById.get(s.department_id) || 'этап');
    if (skipped.length > 0) {
      issues.push({
        kind: 'skip',
        text: `Будут пропущены незавершённые этапы: ${skipped.join(', ')}.`,
      });
    }
  }

  const done = stage.qty_done ?? 0;
  if (stage.status !== 'done' && done < item.qty) {
    issues.push({
      kind: 'unfinished',
      text: `На текущем этапе сделано ${done} из ${item.qty} шт — он будет отмечен завершённым.`,
    });
  }

  return {
    allowed: true,
    targetStage,
    requiresComment: issues.some((i) => i.kind === 'back' || i.kind === 'skip'),
    issues,
  };
}

/**
 * Текст подтверждения для диалога: главный вопрос + последствия.
 * Формат из требования: «Перенести заказ в швейный цех? Текущий этап «Вышивка»
 * будет отмечен завершённым.»
 */
export function moveConfirmMessage(
  plan: StageMovePlan,
  sourceDeptName: string,
  targetDeptName: string,
): string {
  const head = `Текущий этап «${sourceDeptName}» будет отмечен завершённым, задание уйдёт в «${targetDeptName}».`;
  return [head, ...plan.issues.map((i) => i.text)].join(' ');
}
