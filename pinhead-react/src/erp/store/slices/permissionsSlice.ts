/**
 * Слайс прав (ядро правки 11): матрица «роль × право» из erp_role_permissions.
 *
 * Грузится один раз при монтировании оболочки (ErpLayout). Ошибка загрузки не
 * блокирует работу цеха — экраны падают на DEFAULT_PERMISSIONS (utils/permissions.ts),
 * поэтому toast здесь предупреждающий, а не ошибочный.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpQuery } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpRolePermission } from '../../types';
import type { PermissionMatrix } from '../../utils/permissions';
import type { ErpStore, PermissionsSlice } from '../types';

export const permissionsSlice: StateCreator<ErpStore, [], [], PermissionsSlice> = (set, get) => ({
  permissionMatrix: null,
  permissionsLoaded: false,

  loadPermissions: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_role_permissions')
      .select('role, permission, allowed'));
    if (error) {
      // Работаем на дефолтах — молча, чтобы не пугать цех на каждом заходе
      set({ permissionsLoaded: true });
      return;
    }
    const matrix: PermissionMatrix = {};
    for (const row of (data ?? []) as ErpRolePermission[]) {
      (matrix[row.role] ??= {})[row.permission] = row.allowed;
    }
    set({ permissionMatrix: matrix, permissionsLoaded: true });
  },

  setRolePermission: async (role, permission, allowed) => {
    const prev = get().permissionMatrix;
    // optimistic: галочка в матрице отзывается сразу, при ошибке возвращаем как было
    set((s) => ({
      permissionMatrix: {
        ...(s.permissionMatrix ?? {}),
        [role]: { ...(s.permissionMatrix?.[role] ?? {}), [permission]: allowed },
      },
    }));
    // Строка могла не существовать (право добавили кодом позже сида) — upsert по паре
    const { error } = await erpQuery(() => supabase
      .from('erp_role_permissions')
      .upsert({ role, permission, allowed }, { onConflict: 'role,permission' }));
    if (error) {
      set({ permissionMatrix: prev });
      toast.error('Не удалось сохранить право');
      return false;
    }
    return true;
  },
});
