import { createAttemptKeeper } from '../utils/attemptKey';

/**
 * КЛЮЧИ ПОПЫТОК СДАЧИ — по этапу (правка 27.09, п. 4).
 *
 * «Повторное сохранение результата не должно списывать материал ещё раз».
 * Обрыв ответа при закоммиченной сдаче на цеховом Wi-Fi — обычное дело,
 * и второе нажатие списало бы метры с рулона дважды. Ключ живёт, пока
 * не менялся ввод (тот же приём, что у приёмки склада), и сбрасывается
 * после успеха: следующая сдача — новая.
 *
 * Живут в МОДУЛЕ, а не в состоянии стора: перерисовка от realtime не должна
 * сбрасывать их ровно в тот момент, когда они нужны. Вынесено из
 * `stagesSlice` — тот стоит на потолке ратчета размера.
 */
const attempts = new Map<string, ReturnType<typeof createAttemptKeeper>>();

/** Ключ попытки для этапа и ввода: тот же ввод — тот же ключ */
export function attemptKeyFor(stageId: string, input: unknown): string {
  let keeper = attempts.get(stageId);
  if (!keeper) {
    keeper = createAttemptKeeper();
    attempts.set(stageId, keeper);
  }
  return keeper.keyFor(JSON.stringify(input));
}

/** После успеха: следующая сдача этапа — новая попытка */
export function resetAttempt(stageId: string): void {
  attempts.get(stageId)?.reset();
}
