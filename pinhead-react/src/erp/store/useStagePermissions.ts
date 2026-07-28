import { useMemo } from 'react';
import { useErpAccess } from './useErpAccess';

/**
 * Права цеха на конкретный этап — одним объектом.
 *
 * Раньше все кнопки задания рисовались под одним булевым `canAct`, который
 * проверял только принадлежность цеху. Матрица прав из админки при этом
 * объявляла пять отдельных прав на этапы, и ни одно из них не проверялось:
 * руководитель снимал «Оформлять брак», видел галочку снятой и считал вопрос
 * закрытым, а кнопка у рабочего оставалась. Здесь — единственное место, где
 * набор считается, чтобы очередь, мобильная карточка и страница задания
 * не разошлись.
 *
 * `inDept` вынесен отдельно: это не право, а «ваш ли это цех» — по нему
 * рисуется пояснение «только просмотр», а не гейт кнопок.
 */
export interface StagePermissions {
  /** Цех пользователя (или руководящий доступ) — для пояснения «только просмотр» */
  inDept: boolean;
  take: boolean;
  progress: boolean;
  complete: boolean;
  block: boolean;
  defect: boolean;
  /** Хоть одно действие доступно — рисовать ли блок действий вообще */
  any: boolean;
}

export function useStagePermissions(departmentId: string | null | undefined): StagePermissions {
  const access = useErpAccess();
  return useMemo(() => {
    const take = access.canDo('stage.take', departmentId);
    const progress = access.canDo('stage.progress', departmentId);
    const complete = access.canDo('stage.complete', departmentId);
    const block = access.canDo('stage.block', departmentId);
    const defect = access.canDo('stage.defect', departmentId);
    return {
      inDept: access.canActIn(departmentId),
      take,
      progress,
      complete,
      block,
      defect,
      any: take || progress || complete || block || defect,
    };
  }, [access, departmentId]);
}
