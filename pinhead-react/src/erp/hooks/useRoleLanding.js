import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useErpAccess } from '../store/useErpAccess';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { landingPathForRole } from '../utils/landing';
import { myDeptCode } from '../utils/myDept';

/**
 * ПОСАДОЧНАЯ ПО РОЛИ (обход 04.09, Б2). Срабатывает ОДИН раз за загрузку
 * приложения — в тот момент, когда пакет оболочки принёс роль, — и только
 * если человек всё ещё стоит на `/`.
 *
 * ПОЧЕМУ НЕ РЕДИРЕКТ НА КАЖДОМ ВХОДЕ НА `/`. «Обзор» остаётся пунктом меню
 * у всех: открыв его руками, человек обязан его получить, а не быть отброшен
 * назад в свой цех. Поэтому решение принимается на загрузке, а не на маршруте.
 *
 * ПОЧЕМУ `myRole`, А НЕ `bootstrapLoaded`. При отказе RPC слайс поднимает флаг
 * с пустыми данными, а `resolveErpRole` без роли с сервера отдаёт `worker` —
 * то есть при обрыве связи менеджера уносило бы в очередь цеха. Пустая роль
 * означает «не знаем», и не знать — значит остаться на обзоре.
 */
export function useRoleLanding(canOpen) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { role } = useErpAccess();
  const { myRole, myDeptId, departments } = useErpStore(useShallow((s) => ({
    myRole: s.myRole,
    myDeptId: s.myDeptId,
    departments: s.departments,
  })));
  /* Решение принимается один раз за загрузку приложения. Флаг поднимается
     ТОЛЬКО когда роль приехала: до этого эффект выходит, не потратив попытку. */
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || !myRole) return;
    decided.current = true;
    // Успел уйти с обзора, пока летел пакет, — значит уже знает, куда шёл
    if (pathname !== '/') return;
    /**
     * Участок берётся из ТОГО ЖЕ пакета, что и роль: `erp_bootstrap` привозит
     * `myRole` и `myDeptId` вместе, поэтому к моменту решения привязка уже
     * известна — отдельного ожидания не нужно. Справочник цехов приезжает тем
     * же пакетом; пока его нет, `myDeptCode` откатится на последний выбранный
     * участок, а при полном незнании отдаст пустую строку, и человек останется
     * на обзоре вместо `/queue/undefined`.
     */
    const target = landingPathForRole(role, {
      canOpen,
      deptCode: myDeptCode(departments, myDeptId),
    });
    if (target) navigate(target, { replace: true });
  }, [myRole, myDeptId, departments, pathname, role, canOpen, navigate]);
}

