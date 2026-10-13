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
  /**
   * Завершить этап принудительно (правка 20.09, п. 5). Цех вызывающего
   * НЕ проверяется — как у пропуска: разбирает последствия обновления тот,
   * кто ведёт систему, а он не состоит ни в одном цехе. Ровно то же
   * исключение стоит в `erp_stage_guard`, иначе вышло бы «кнопка есть,
   * действие падает».
   */
  forceComplete: boolean;
  /** Хоть одно действие доступно — рисовать ли блок действий вообще */
  any: boolean;
  /**
   * Действий нет ровно потому, что профиль не привязан к участку. Пробрасывается
   * из `useErpAccess`, чтобы экран задания не поднимал второй хук ради одного
   * булева и чтобы причина пустого блока действий была названа там же, где он
   * рисуется.
   */
  needsDeptBinding: boolean;
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
    const forceComplete = access.can('stage.force_complete');
    return {
      inDept: access.canActIn(departmentId),
      take,
      progress,
      complete,
      block,
      defect,
      skip,
      plan,
      forceComplete,
      any: take || progress || complete || block || defect || skip || plan || forceComplete,
      needsDeptBinding: access.needsDeptBinding,
    };
  }, [access, departmentId]);
}
