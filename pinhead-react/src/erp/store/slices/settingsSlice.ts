/**
 * Слайс настроек производства (правки заказчика 10.08, волна 2).
 *
 * Сегодня здесь одна настройка — общая мощность в единицах за месяц. Данные —
 * `erp_settings` (key/value), право на запись — `plan.manage`: мощность это
 * часть планирования, а не отдельная сущность со своим правом.
 *
 * Fail-open по всей длине: не загрузилось — мощность «не задана», интерфейс
 * покажет «—» вместо выдуманного процента. Показать 100 % там, где знаменатель
 * неизвестен, хуже, чем не показать ничего.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import {
  CAPACITY_SETTINGS_KEY, DEFAULT_CAPACITY, parseCapacitySettings,
} from '../../utils/capacity';
import type { CapacitySettings } from '../../utils/capacity';
import { currentActor, erpError, erpQuery, erpRead } from '../shared';
import { useAuthStore } from '../../../store/useAuthStore';
import type { ErpStore, SettingsSlice } from '../types';

/** uuid действующего пользователя; dev-режим валидного uuid не даёт */
function currentActorId(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id && id !== 'dev' ? id : null;
}

export const settingsSlice: StateCreator<ErpStore, [], [], SettingsSlice> = (set) => ({
  capacity: { ...DEFAULT_CAPACITY },
  capacityLoaded: false,

  loadSettings: async () => {
    const { data, error } = await erpRead(() => supabase
      .from('erp_settings')
      .select('key, value')
      .eq('key', CAPACITY_SETTINGS_KEY)
      .maybeSingle());
    if (error) {
      set({ capacityLoaded: true });
      erpError('Не удалось загрузить настройки производства', error);
      return;
    }
    set({
      capacity: parseCapacitySettings((data as { value?: unknown } | null)?.value),
      capacityLoaded: true,
    });
  },

  saveCapacity: async (next: CapacitySettings) => {
    if (next.monthly_units !== null && !(next.monthly_units > 0)) {
      toast.error('Мощность — положительное число единиц в месяц');
      return false;
    }
    if (!(next.work_days_per_week >= 1 && next.work_days_per_week <= 7)) {
      toast.error('Рабочих дней в неделе — от 1 до 7');
      return false;
    }
    // НЕ optimistic: настройка действует на всех, и показать сохранённым то,
    // что сервер отклонил по правам, значит планировать против несуществующей
    // мощности. Разница в одну секунду, цена ошибки — месяц работы.
    const { error } = await erpQuery(() => supabase
      .from('erp_settings')
      .upsert({
        key: CAPACITY_SETTINGS_KEY,
        value: next as unknown as Record<string, unknown>,
        updated_by: currentActor(),
        updated_by_id: currentActorId(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' }));
    if (error) {
      erpError('Мощность не сохранена', error);
      return false;
    }
    set({ capacity: { ...next }, capacityLoaded: true });
    toast.success('Мощность производства сохранена');
    return true;
  },
});
