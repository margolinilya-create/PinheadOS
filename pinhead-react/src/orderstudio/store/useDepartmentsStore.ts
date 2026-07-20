import { create } from 'zustand';
import { DEPARTMENTS, type Department } from '../../erp/data/departments';

interface DepartmentsState {
  departments: Department[];
  getByCode: (code: string) => Department | undefined;
}

/**
 * Справочник цехов. Пока читается из seed-данных.
 * TODO(P1): загрузка/CRUD через Supabase (таблица departments).
 */
export const useDepartmentsStore = create<DepartmentsState>((_set, get) => ({
  departments: [...DEPARTMENTS].sort((a, b) => a.order - b.order),
  getByCode: (code) => get().departments.find((d) => d.code === code),
}));
