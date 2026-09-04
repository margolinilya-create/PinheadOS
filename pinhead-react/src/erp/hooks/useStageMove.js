import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { confirmWithInput } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { analyzeStageMove, moveConfirmMessage } from '../utils/stageMove';
import { deptShortName, isProductionDept } from '../data/departments';

/**
 * ПЕРЕНОС ЗАДАНИЯ В ДРУГОЙ ЦЕХ — ОДНА РЕАЛИЗАЦИЯ НА ВСЕ ПОВЕРХНОСТИ.
 *
 * §2.5 обхода 04.09: `moveStageToDepartment` звал ТОЛЬКО канбан, а вид доски
 * по умолчанию — таблица. Диспетчер, увидевший затор в очереди участка,
 * обязан был уйти на доску, переключить вид и найти там ту же карточку.
 * Операция при этом дважды признавалась важной: 03.09 ей завели клавиатурный
 * путь (WCAG 2.1.1), а право `stage.move_department` заказчик отдельным
 * решением выдал менеджеру.
 *
 * Логика переноса — подтверждение с последствиями, обязательная причина
 * при возврате назад и пропуске этапов — не переписывается на второй
 * поверхности: она уезжает СЮДА целиком, и оба вызывающих зовут одну функцию.
 * Две копии текста подтверждения однажды разошлись бы с фактом — ровно то,
 * ради чего `utils/stageMove` и заведён отдельным модулем.
 */
export function useStageMove() {
  const { departments, moveStageToDepartment } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      moveStageToDepartment: s.moveStageToDepartment,
    })),
  );
  const access = useErpAccess();

  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])), [departments],
  );

  /**
   * Куда можно перенести: активные ПРОИЗВОДСТВЕННЫЕ участки, кроме своего.
   * Признак из данных (`is_production`), а не список кодов — участок,
   * заведённый в админке завтра, обязан попадать в тот же перечень.
   */
  const targetsFor = useCallback(
    (stage) => departments
      .filter((d) => d.active && isProductionDept(d) && d.id !== stage?.department_id)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments],
  );

  const canMove = useCallback(
    (stage) => access.canDo('stage.move_department', stage?.department_id),
    [access],
  );

  const moveStageTo = useCallback(async (entry, dept) => {
    if (!entry || !dept || entry.stage.department_id === dept.id) return false;
    if (!canMove(entry.stage)) {
      toast.error('Нет права переносить задания между цехами');
      return false;
    }

    const plan = analyzeStageMove({
      stage: entry.stage,
      item: entry.item,
      targetDeptId: dept.id,
      targetDeptName: dept.name,
      deptNameById,
    });
    if (!plan.allowed) {
      toast.error(plan.issues[0]?.text || 'Перенос невозможен');
      return false;
    }

    const sourceName = deptNameById.get(entry.stage.department_id) || 'цех';
    const targetName = deptShortName(dept.code, dept.name);
    // Возврат назад и пропуск этапов заказчик просил сопровождать комментарием —
    // спрашиваем его прямо в диалоге подтверждения, одним шагом
    const { ok, value } = await confirmWithInput({
      title: `Перенести заказ в «${dept.name}»?`,
      message: moveConfirmMessage(plan, sourceName, targetName),
      confirmLabel: 'Перенести',
      variant: plan.requiresComment ? 'danger' : undefined,
      prompt: plan.requiresComment
        ? {
            label: 'Причина переноса (попадёт в историю заказа)',
            placeholder: 'напр. брак на предыдущем этапе',
            required: true,
          }
        : undefined,
    });
    if (!ok) return false;
    return moveStageToDepartment(entry.stage.id, dept.id, { comment: value || null });
  }, [canMove, deptNameById, moveStageToDepartment]);

  return { moveStageTo, canMove, targetsFor };
}
