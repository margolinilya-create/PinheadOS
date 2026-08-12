/**
 * Слайс сотрудников и профилей: список, привязка цеха, роли.
 * Профили общие с Order Studio (таблица profiles); цеховая надстройка — erp_employees.
 * Вынесен из useErpStore.ts (рефакторинг по плану аудита).
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { erpError, erpQuery, erpRefused, rlsRefused } from '../shared';
import { toast } from '../../../store/useToastStore';
import type { ErpDepartment, ErpEmployee } from '../../types';
import type { ErpStore, EmployeesSlice, StaffProfile } from '../types';

export const employeesSlice: StateCreator<ErpStore, [], [], EmployeesSlice> = (set, get) => ({
  employees: [],
  profilesList: [],
  employeesLoaded: false,
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
    /*
     * Оба запроса — через `erpQuery`, и это не косметика.
     *
     * Это были единственные два сетевых вызова во всех слайсах ERP, шедшие
     * голым `supabase`. Правило раздела: supabase-js возвращает `error`
     * на ОТВЕТ сервера и БРОСАЕТ, когда ответа не было (нет сети, CORS).
     * При обрыве связи `Promise.all` отклонялся, ветка `if (emps.error …)`
     * не выполнялась вовсе, `employeesLoaded` оставался `false` — и человек
     * получал unhandled rejection в консоли, вечный скелетон, ни тоста,
     * ни кнопки «Повторить». Повторной попытки не было: эффект
     * `if (!employeesLoaded) loadEmployees()` второй раз не срабатывает,
     * потому что его зависимости не менялись. Единственным выходом был F5.
     */
    const [emps, profs] = await Promise.all([
      erpQuery(() => supabase.from('erp_employees').select('*').order('full_name')),
      erpQuery(() => supabase
        .from('profiles')
        .select('id, name, email, role, approved, active')
        .order('name')),
    ]);
    if (emps.error || profs.error) {
      erpError('Не удалось загрузить сотрудников', emps.error ?? profs.error);
      return;
    }
    set({
      employees: (emps.data ?? []) as ErpEmployee[],
      profilesList: (profs.data ?? []) as StaffProfile[],
      employeesLoaded: true,
    });
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
    // `.select()` обязателен: политика стоит на `is_admin()`, а RLS запрещает
    // UPDATE через `USING` — это «0 строк», а не ошибка. Без него смена роли
    // или цеха сотрудника показывалась сохранённой и возвращалась при F5.
    const { data, error } = await erpQuery(() => supabase
      .from('erp_employees').update(patch).eq('id', id).select('id'));
    if (error) {
      set({ employees: prev });
      erpError('Не удалось обновить сотрудника', error);
      return false;
    }
    if (rlsRefused(data)) {
      set({ employees: prev });
      return erpRefused('Сотрудник не обновлён', 'управление сотрудниками доступно только администратору');
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
    // `.select()` обязателен по той же причине, что у сотрудников: отказ RLS
    // на UPDATE — это «0 строк». Здесь он особенно дорог: через этот же путь
    // правится `gate_material_kinds`, то есть материальный гейт участка.
    const { data, error } = await erpQuery(() => supabase
      .from('erp_departments').update(patch).eq('id', id).select('id'));
    if (error) {
      set({ departments: prev });
      erpError('Не удалось сохранить участок', error);
      return false;
    }
    if (rlsRefused(data)) {
      set({ departments: prev });
      return erpRefused('Участок не сохранён', 'нужно право «Править справочники»');
    }
    return true;
  },
});
