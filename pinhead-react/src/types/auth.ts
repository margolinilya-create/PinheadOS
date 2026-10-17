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
  /** Ведёт заказы: заводит заказы v4 (миграция E; ставит руководство продаж) */
  is_sales: boolean;
  /** МС: видит заказы в работе и запускает их в производство (миграция F) */
  is_ms: boolean;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
  active: boolean;
  is_sales: boolean;
  is_ms: boolean;
}
