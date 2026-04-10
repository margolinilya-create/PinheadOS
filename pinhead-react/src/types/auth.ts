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
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  approved: boolean;
  active: boolean;
}
