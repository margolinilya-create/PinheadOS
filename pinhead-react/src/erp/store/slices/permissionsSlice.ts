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

/** Сколько последних правок показывать в админке — не журнал, а «кто трогал недавно» */
const TRAIL_LIMIT = 10;

export const permissionsSlice: StateCreator<ErpStore, [], [], PermissionsSlice> = (set, get) => ({
  permissionMatrix: null,
  permissionTrail: [],
  permissionsLoaded: false,
  permissionsError: null,

  loadPermissions: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_role_permissions')
      .select('role, permission, allowed, updated_at, updated_by'));
    if (error) {
      /**
       * Fail-open для ЦЕХА остаётся: работаем на дефолтах молча, чтобы
       * не пугать рабочего на каждом заходе. Но отказ теперь ЗАПОМИНАЕТСЯ —
       * его читает редактор матрицы в админке (правка 03.09).
       *
       * Причина: `isAllowed` при пустой матрице падает на `DEFAULT_PERMISSIONS`,
       * и вкладка «Права» рисовала правдоподобную матрицу, которой нет в базе.
       * Админ видел галочку у права, снятого на сервере, делал вывод «право
       * есть» — а цех получал 42501 на кнопке, которая по матрице разрешена.
       * Экран настроек — худшее место для правдоподобно неверных данных.
       */
      set({ permissionsLoaded: true, permissionsError: error.message });
      return;
    }
    const matrix: PermissionMatrix = {};
    const rows = (data ?? []) as ErpRolePermission[];
    for (const row of rows) {
      (matrix[row.role] ??= {})[row.permission] = row.allowed;
    }
    /**
     * СЛЕД ПРАВОК МАТРИЦЫ (§5 обхода 04.09). До 04.09 клик по галочке
     * записывался мгновенно и не оставлял НИКАКОГО следа: кто и когда снял
     * право, узнать было негде — а это единственная в разделе настройка,
     * которая молча отключает людям работу.
     *
     * Полной истории здесь нет и не подразумевается: строка одна на пару
     * «роль × право», значит видно последнего писателя, а не все правки.
     * Так и подписано на экране — половина ответа лучше, чем ничего,
     * но выдавать её за журнал нельзя.
     */
    const trail = rows
      .filter((r) => r.updated_by)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, TRAIL_LIMIT);
    set({
      permissionMatrix: matrix, permissionTrail: trail,
      permissionsLoaded: true, permissionsError: null,
    });
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
