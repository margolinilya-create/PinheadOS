/**
 * Единая точка «что мне можно» для экранов ERP (ядро правки 11).
 *
 * Собирает воедино три источника, которые раньше жили по разным экранам:
 *  - роль профиля Order Studio (useAuthStore);
 *  - цеховая роль и привязка к цеху (erp_employees, loadMyDept);
 *  - матрица «роль × право» из БД (erp_role_permissions).
 *
 * Возвращает `can(permission)` — что роли можно вообще, и `canActIn(deptId)` —
 * можно ли действовать в конкретном цехе. Оба гейта применяются вместе:
 * бригадир швейки не закрывает этапы вышивки, даже имея право stage.complete.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import type { EmployeeRole, ErpPermission } from '../types';
import {
  FULL_ACCESS_PROFILE_ROLES,
  canActInDept,
  isAllowed,
  resolveErpRole,
} from '../utils/permissions';
import { useErpStore } from './useErpStore';

export interface ErpAccess {
  /** Разрешено ли право роли пользователя (без учёта цеха) */
  can: (permission: ErpPermission) => boolean;
  /** Может ли пользователь действовать в этом цехе */
  canActIn: (departmentId: string | null | undefined) => boolean;
  /** `can` и `canActIn` вместе — основной гейт кнопок в очереди и на канбане */
  canDo: (permission: ErpPermission, departmentId: string | null | undefined) => boolean;
  /** Руководящий состав (или dev): работает во всех цехах, привязка не ограничивает */
  isPrivileged: boolean;
  /**
   * Профиль администратора (или dev). УЖЕ, чем `isPrivileged`, и это намеренно:
   * необратимое удаление заказа на сервере стоит под `is_admin()`, а
   * `isPrivileged` — это ещё директор и РОП. Гейт интерфейса обязан совпадать
   * с политикой базы, иначе кнопка есть, а действие молча не проходит.
   */
  isAdmin: boolean;
  /** Роль, по которой резолвятся права */
  role: EmployeeRole;
  /** Цех пользователя (null — привязки нет) */
  myDeptId: string | null;
}

export function useErpAccess(): ErpAccess {
  const user = useAuthStore((s) => s.user);
  const { myDeptId, myRole, permissionMatrix } = useErpStore(
    useShallow((s) => ({
      myDeptId: s.myDeptId,
      myRole: s.myRole,
      permissionMatrix: s.permissionMatrix,
    })),
  );

  return useMemo(() => {
    const isDev = user?.id === 'dev';
    const role = resolveErpRole(user?.role, myRole);
    // dev-режим (локальный автологин) — полный доступ, как и раньше на всех экранах
    const can = (permission: ErpPermission) =>
      isDev || isAllowed(permissionMatrix, role, permission);
    const canActIn = (departmentId: string | null | undefined) =>
      canActInDept(user?.role, myDeptId, departmentId, isDev);
    return {
      can,
      canActIn,
      canDo: (permission, departmentId) => can(permission) && canActIn(departmentId),
      isPrivileged: isDev || FULL_ACCESS_PROFILE_ROLES.includes(user?.role ?? ''),
      // Зеркало серверной `is_admin()`: та проверяет profiles.role = 'admin'
      isAdmin: isDev || user?.role === 'admin',
      role,
      myDeptId,
    };
  }, [user?.id, user?.role, myRole, myDeptId, permissionMatrix]);
}
