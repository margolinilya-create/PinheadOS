// ── Auth types ──

export type UserRole = 'admin' | 'director' | 'rop' | 'manager' | 'production' | 'designer';

export type ProfileStatus = 'active' | 'pending_approval' | 'disabled' | 'no_profile';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  approved: boolean;
  active: boolean;
  /** Менеджер продаж: заводит заказы v4 (миграция E, ставят admin/director) */
  is_sales: boolean;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
  active: boolean;
  is_sales: boolean;
}
