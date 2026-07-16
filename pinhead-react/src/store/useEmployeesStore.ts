import { create } from 'zustand';

export interface Employee {
  id: string;
  name: string;
  login: string;
  role: string;
  /** Код основного цеха (departments.code) */
  departmentCode: string;
  /** Дополнительные цеха, где может помогать */
  extraDepartments?: string[];
  isForeman: boolean;
  active: boolean;
}

interface EmployeesState {
  employees: Employee[];
  loading: boolean;
  // TODO(P1): CRUD через Supabase (HR + Директор), soft-delete (active=false)
}

/**
 * Сотрудники. Каркас — данные подключим в Фазе 1.
 */
export const useEmployeesStore = create<EmployeesState>(() => ({
  employees: [],
  loading: false,
}));
