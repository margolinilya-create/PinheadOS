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
  /**
   * Пропустить этап (правки 10.08). Это решение по МАРШРУТУ заказа, а не работа
   * цеха, поэтому право `order.manage`, а не одно из цеховых, и цех вызывающего
   * здесь не проверяется: пропускает тот, кто ведёт заказ, а он не в цехе.
   */
  skip: boolean;
  /**
   * Поставить задание в план на день (правки 10.08). Право `plan.manage` —
   * то же, что у общего экрана плана: раскладывает работу руководитель
   * производства, и локальная кнопка в цехе не должна давать больше, чем
   * даёт общий экран. Цех вызывающего не проверяется по той же причине —
   * планирует не цех.
   */
  plan: boolean;
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
    const skip = access.can('order.manage');
    const plan = access.can('plan.manage');
    return {
      inDept: access.canActIn(departmentId),
      take,
      progress,
      complete,
      block,
      defect,
      skip,
      plan,
      any: take || progress || complete || block || defect || skip || plan,
    };
  }, [access, departmentId]);
}
