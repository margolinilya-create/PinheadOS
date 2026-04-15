// ── Auth types ──

export type UserRole = 'admin' | 'director' | 'rop' | 'manager' | 'production' | 'designer' | 'hr';

// Production sub-specialization, see 20260501_production_foundation.sql.
// Populated from profiles.sub_role. Null for non-production roles.
export type SubRole = 'foreman' | 'senior_foreman' | 'technologist' | 'procurement' | 'qc_operator';

export type ProfileStatus = 'active' | 'pending_approval' | 'disabled' | 'no_profile';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  sub_role: SubRole | null;
  approved: boolean;
  active: boolean;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  sub_role: SubRole | null;
  approved: boolean;
  active: boolean;
}
