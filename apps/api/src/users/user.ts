export type Role = 'SUBMITTER' | 'AUDITOR' | 'SYSTEM_ADMIN';

export interface AppUser {
  id: string;
  username: string;
  tenantId: string | null;
  tenantName: string | null;
  role: Role;
}

export const normalizeUsername = (value: string) =>
  value.trim().normalize('NFC').toLowerCase();