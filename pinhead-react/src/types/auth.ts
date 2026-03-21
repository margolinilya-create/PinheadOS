// ── Auth types ──

export type UserRole = 'admin' | 'director' | 'rop' | 'manager' | 'production' | 'designer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  approved: boolean;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
}
