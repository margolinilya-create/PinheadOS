/**
 * Слайс сотрудников и профилей: список, привязка цеха, роли.
 * Профили общие с Order Studio (таблица profiles); цеховая надстройка — erp_employees.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpQuery, erpError } from '../shared';
import { adminUsers } from '../adminUsers';
import { toast } from '../../../store/useToastStore';
import type { ErpDepartment, ErpEmployee } from '../../types';
import type { ErpStore, EmployeesSlice, StaffProfile } from '../types';

export const employeesSlice: StateCreator<ErpStore, [], [], EmployeesSlice> = (set, get) => ({
  employees: [],
  profilesList: [],
  employeesLoaded: false,
  employeesError: null,
  myDeptId: null,
  myRole: null,
  myDeptLoaded: false,

  loadMyDept: async (profileId) => {
    // dev-режим и отсутствие логина — свободный выбор, запрос не нужен
    if (!profileId || profileId === 'dev') {
      set({ myDeptId: null, myRole: null, myDeptLoaded: true });
      return;
    }
    const { data, error } = await erpQuery(() => supabase
      .from('erp_employees')
      .select('department_id, role')
      .eq('profile_id', profileId)
      .eq('active', true)
      .limit(1));
    if (error) {
      toast.error('Не удалось определить ваш цех');
      set({ myDeptLoaded: true });
      return;
    }
    set({
      myDeptId: data?.[0]?.department_id ?? null,
      myRole: (data?.[0]?.role as ErpEmployee['role'] | undefined) ?? null,
      myDeptLoaded: true,
    });
  },

  loadEmployees: async () => {
    /**
     * Сбой оставлял экран НАВСЕГДА пустым: `employeesLoaded` не поднимался,
     * а эффект `if (!employeesLoaded) loadEmployees()` второй раз не срабатывает
     * (зависимости те же). Выходом была только перезагрузка страницы — ровно то,
     * что правило UX-2 запрещает. Теперь причина запоминается, и экран рисует
     * `LoadFailed` с «Повторить».
     *
     * Оба чтения — через `erpQuery`: supabase-js БРОСАЕТ, когда ответа не было
     * вовсе (нет сети, CORS), и голый `await` дал бы unhandled rejection вместо
     * обычной ветки `if (error)`.
     */
    set({ employeesError: null });
    const [emps, profs] = await Promise.all([
      erpQuery(() => supabase.from('erp_employees').select('*').order('full_name')),
      erpQuery(() => supabase
        .from('profiles')
        .select('id, name, email, role, approved, active')
        .order('name')),
    ]);
    const error = emps.error || profs.error;
    if (error) {
      set({ employeesError: error.message });
      return erpError('Не удалось загрузить сотрудников', error);
    }
    set({
      employees: (emps.data ?? []) as ErpEmployee[],
      profilesList: (profs.data ?? []) as StaffProfile[],
      employeesLoaded: true,
    });
    return true;
  },

  updateProfile: async (id, patch) => {
    const prev = get().profilesList;
    set((s) => ({
      profilesList: s.profilesList.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
    const { error } = await erpQuery(() => supabase.from('profiles').update(patch).eq('id', id));
    if (error) {
      set({ profilesList: prev });
      toast.error('Не удалось обновить пользователя');
      return false;
    }
    return true;
  },

  /**
   * Завести человека с готовым паролем — второй путь рядом с приглашением.
   *
   * Приглашение остаётся основным: человек задаёт пароль сам, и админ его
   * не знает. Но случай «сотрудник рядом, заведи прямо сейчас» и случай
   * «ссылку потеряли» приглашением не закрываются никак, и до сих пор
   * единственным выходом был дашборд Supabase.
   *
   * Список перечитываем целиком: профиль и строку сотрудника пишет ТРИГГЕР,
   * и собрать их на клиенте значит угадывать, что именно он записал.
   */
  createUserAccount: async (draft) => {
    const { error } = await adminUsers<{ id: string }>('create', {
      email: draft.email,
      password: draft.password,
      name: draft.name,
      profile_role: draft.profile_role,
      employee_role: draft.employee_role,
      department_id: draft.department_id || null,
    });
    if (error) return erpError('Не удалось завести пользователя', error);
    await get().loadEmployees();
    toast.success('Пользователь заведён');
    return true;
  },

  /**
   * Пароль сотруднику задаёт админ. Восстановление по письму остаётся, но
   * письма шлёт встроенный SMTP (порядка двух в час, у gmail спам) — на этом
   * в проекте уже вставали люди, и «позвони, я поставлю новый» надёжнее.
   */
  setUserPassword: async (userId, password) => {
    const { error } = await adminUsers('set_password', { user_id: userId, password });
    if (error) return erpError('Не удалось сменить пароль', error);
    toast.success('Пароль изменён');
    return true;
  },

  /** Адрес — это ЛОГИН: сервер меняет его и в `auth.users`, и в `profiles` */
  setUserEmail: async (userId, email) => {
    const next = email.trim().toLowerCase();
    const { error } = await adminUsers('set_email', { user_id: userId, email: next });
    if (error) return erpError('Не удалось сменить email', error);
    set((s) => ({
      profilesList: s.profilesList.map((p) => (p.id === userId ? { ...p, email: next } : p)),
    }));
    toast.success('Email изменён');
    return true;
  },

  /**
   * Безвозвратное удаление — НЕ замена «Отключить», а другое действие.
   * Обычный путь остаётся мягким (`active = false`): у отключённого сохраняется
   * история и его можно вернуть. Удаление нужно для учётной записи, заведённой
   * по ошибке; сервер откажет, если за человеком числятся заказы.
   *
   * Оптимистично не убираем: правило проекта — удаление ждёт ответа.
   */
  deleteUserAccount: async (userId) => {
    const { error } = await adminUsers('delete', { user_id: userId });
    if (error) return erpError('Не удалось удалить пользователя', error);
    set((s) => ({
      profilesList: s.profilesList.filter((p) => p.id !== userId),
      employees: s.employees.filter((e) => e.profile_id !== userId),
    }));
    toast.success('Пользователь удалён');
    return true;
  },

  upsertProfileDept: async (profile, patch) => {
    const existing = get().employees.find((e) => e.profile_id === profile.id);
    if (existing) return get().updateEmployee(existing.id, patch);
    const created = await get().createEmployee({
      full_name: profile.name || profile.email || 'Без имени',
      profile_id: profile.id,
      role: 'worker',
      ...patch,
    });
    return Boolean(created);
  },

  createEmployee: async (emp) => {
    const { data, error } = await erpQuery(() => supabase.from('erp_employees').insert(emp).select());
    const row = data?.[0] as ErpEmployee | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить сотрудника');
      return null;
    }
    set((s) => ({ employees: [...s.employees, row].sort((a, b) => a.full_name.localeCompare(b.full_name)) }));
    return row;
  },

  updateEmployee: async (id, patch) => {
    const prev = get().employees;
    set((s) => ({
      employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
    const { error } = await erpQuery(() => supabase.from('erp_employees').update(patch).eq('id', id));
    if (error) {
      set({ employees: prev });
      toast.error('Не удалось обновить сотрудника');
      return false;
    }
    return true;
  },

  createDepartment: async (dept) => {
    const { data, error } = await erpQuery(() => supabase
      .from('erp_departments')
      .insert({ type: 'other', ...dept })
      .select());
    const row = data?.[0] as ErpDepartment | undefined;
    if (error || !row) {
      toast.error('Не удалось добавить участок');
      return null;
    }
    set((s) => ({
      departments: [...s.departments, row].sort((a, b) => a.sort_order - b.sort_order),
    }));
    return row;
  },

  updateDepartment: async (id, patch) => {
    const prev = get().departments;
    set((s) => ({
      departments: s.departments
        .map((d) => (d.id === id ? { ...d, ...patch } : d))
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
    const { error } = await erpQuery(() => supabase.from('erp_departments').update(patch).eq('id', id));
    if (error) {
      set({ departments: prev });
      toast.error('Не удалось сохранить участок');
      return false;
    }
    return true;
  },
});
