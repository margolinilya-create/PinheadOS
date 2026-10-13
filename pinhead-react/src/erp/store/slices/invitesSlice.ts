/**
 * Слайс приглашений по ссылке (`erp_invites`).
 *
 * Приглашение заменяет четырёхшаговое заведение сотрудника (регистрация →
 * письмо → одобрение → назначение роли и цеха) одним действием админа: он
 * выбирает роль и цех, получает ссылку и отдаёт её человеку сам. Писем в этом
 * пути нет вовсе — а именно на письмах прежний порядок и вставал.
 *
 * Гашение кода живёт НА СЕРВЕРЕ, в триггере регистрации: клиент код только
 * выдаёт, показывает и отзывает. Иначе проверка срока и одноразовости зависела
 * бы от того, что прислал браузер.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpQuery, erpError } from '../shared';
import { useAuthStore } from '../../../store/useAuthStore';
import type { ErpInvite } from '../../types';
import type { ErpStore, InvitesSlice } from '../types';

export const invitesSlice: StateCreator<ErpStore, [], [], InvitesSlice> = (set, get) => ({
  invites: [],
  invitesLoaded: false,

  loadInvites: async () => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_invites')
      .select('*')
      .order('created_at', { ascending: false }));
    if (error) {
      erpError('Не удалось загрузить приглашения', error);
      // Флаг всё равно снимаем: экран обязан показать «Повторить», а не скелетон
      set({ invitesLoaded: true });
      return;
    }
    set({ invites: (data ?? []) as ErpInvite[], invitesLoaded: true });
  },

  createInvite: async (draft) => {
    const expires = new Date(Date.now() + draft.expiresInHours * 3600_000).toISOString();
    const { data, error } = await erpQuery(() => supabase
      .from('erp_invites')
      .insert({
        profile_role: draft.profile_role,
        employee_role: draft.employee_role,
        department_id: draft.department_id,
        // Пустое поле — это «ссылка для любого», а не адрес из пустой строки
        email: draft.email?.trim() || null,
        note: draft.note?.trim() || null,
        expires_at: expires,
        created_by: currentActorId(),
      })
      .select());
    const row = data?.[0] as ErpInvite | undefined;
    if (error || !row) {
      erpError('Не удалось создать приглашение', error);
      return null;
    }
    set((s) => ({ invites: [row, ...s.invites] }));
    return row;
  },

  revokeInvite: async (code) => {
    const prev = get().invites;
    const at = new Date().toISOString();
    set((s) => ({
      invites: s.invites.map((i) => (i.code === code ? { ...i, revoked_at: at } : i)),
    }));
    /**
     * `.select()` обязателен: RLS на UPDATE запрещает через `USING`, то есть
     * отдаёт «обновлено 0 строк», а не ошибку. Клиент, смотрящий только
     * на `error`, показал бы зелёное «Отозвано» на неудавшемся отзыве.
     */
    const { data, error } = await erpQuery(() => supabase
      .from('erp_invites')
      .update({ revoked_at: at })
      .eq('code', code)
      .select());
    if (error || !data?.length) {
      set({ invites: prev });
      erpError('Не удалось отозвать приглашение', error);
      return false;
    }
    return true;
  },
});

/**
 * Кто выдал — как uuid: имя рвётся при переименовании и не различает тёзок
 * (правило проекта). Фиктивный `dev` в боевую колонку не попадает — это тот же
 * фильтр, что стоит у `created_by` заказов.
 */
function currentActorId(): string | null {
  const id = useAuthStore.getState().user?.id;
  return id && id !== 'dev' ? id : null;
}
