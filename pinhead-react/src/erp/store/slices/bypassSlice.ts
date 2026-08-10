/**
 * Слайс аварийно снятых блокировок (правки заказчика 10.08).
 *
 * Когда обязательная проверка из-за бага останавливает работу, руководство снимает
 * именно её — на всю систему или на один заказ, — и производство продолжается,
 * не дожидаясь исправления. Возврат проверки не удаляет запись: журнал «кто снял,
 * зачем и когда вернул» и есть половина смысла этой механики.
 *
 * Правила Pinhead: erpError на каждую ошибку, null при ошибке, optimistic только
 * с откатом, удаления нет вовсе.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import type { BypassKind, ErpBypass } from '../../types';
import { currentActor, erpError, erpQuery, erpRead } from '../shared';
import { useAuthStore } from '../../../store/useAuthStore';
import type { BypassSlice, ErpStore } from '../types';

/** uuid действующего пользователя; dev-режим валидного uuid не даёт */
function currentActorId(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id && id !== 'dev' ? id : null;
}

export const bypassSlice: StateCreator<ErpStore, [], [], BypassSlice> = (set, get) => ({
  bypasses: [],
  bypassesLoaded: false,

  loadBypasses: async () => {
    const { data, error } = await erpRead(() => supabase
      .from('erp_bypasses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200));
    if (error) {
      /**
       * Fail-open, как у справочников и материального гейта: не загрузился список
       * снятий — работаем по обычным правилам. Обратное поведение («не знаем
       * состояние — значит всё разрешено») открыло бы производство настежь
       * из-за обрыва связи.
       */
      set({ bypassesLoaded: true });
      erpError('Не удалось загрузить аварийные отключения', error);
      return;
    }
    set({ bypasses: (data ?? []) as ErpBypass[], bypassesLoaded: true });
  },

  createBypass: async (kind: BypassKind, orderId: string | null, reason: string) => {
    const clean = reason.trim();
    if (!clean) {
      toast.error('Укажите причину — она попадёт в журнал');
      return null;
    }
    // НЕ optimistic: снятие проверки должно появиться на экране только после того,
    // как сервер его принял. Показать снятой блокировку, которую сервер отклонил
    // по правам, значит отправить цех работать по правилам, которых нет.
    const { data, error } = await erpQuery(() => supabase
      .from('erp_bypasses')
      .insert({
        kind,
        order_id: orderId,
        reason: clean,
        created_by: currentActor(),
        created_by_id: currentActorId(),
      })
      .select());
    const row = data?.[0] as ErpBypass | undefined;
    if (error || !row) {
      erpError('Проверка не снята', error);
      return null;
    }
    set((s) => ({ bypasses: [row, ...s.bypasses] }));
    return row;
  },

  restoreBypass: async (id: string) => {
    const prev = get().bypasses;
    const patch = {
      restored_at: new Date().toISOString(),
      restored_by: currentActor(),
      restored_by_id: currentActorId(),
    };
    set((s) => ({ bypasses: s.bypasses.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    const { error } = await erpQuery(() => supabase
      .from('erp_bypasses')
      .update(patch)
      .eq('id', id));
    if (error) {
      set({ bypasses: prev });
      erpError('Проверка не возвращена', error);
      return false;
    }
    return true;
  },
});
