/** Per-user, per-page access level. */
export type AccessLevel = 'none' | 'read' | 'write';

export interface UserPageAccess {
  userEmail: string;   // lowercased on write
  pageKey: string;
  level: AccessLevel;
  grantedBy: string | null;
  grantedAt: string;
}
