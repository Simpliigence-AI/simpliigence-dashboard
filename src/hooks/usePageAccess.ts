/**
 * Access hooks.
 *
 * usePageAccess(pageKey) → 'none' | 'read' | 'write' for the current user.
 * Owner (Raghu) always gets 'write' regardless of what user_page_access
 * says — the matrix is not for restricting the person who owns the
 * matrix. Everyone else needs an explicit row.
 *
 * useCanRevealFinancials() → true if the current user is allowed to reveal
 * masked financial values via the sidebar toggle. Owner is always allowed;
 * anyone else needs authorized_users.can_view_financials = true.
 */
import { useAuthStore } from '../store/useAuthStore';
import { useAccessStore } from '../store/useAccessStore';
import { useIsOwner } from '../components/OwnerOnly';
import type { AccessLevel } from '../types/access';

export function usePageAccess(pageKey: string): AccessLevel {
  const email = useAuthStore((s) => s.currentUser?.email);
  const entries = useAccessStore((s) => s.entries);
  const isOwner = useIsOwner();
  if (isOwner) return 'write';
  if (!email) return 'none';
  const e = email.toLowerCase();
  const row = entries.find((x) => x.userEmail === e && x.pageKey === pageKey);
  return row?.level ?? 'none';
}

/**
 * Whether the current user is allowed to flip the sidebar reveal toggle
 * and see financial values. Non-permitted users still see masked (•••)
 * regardless of what the reveal store says.
 */
export function useCanRevealFinancials(): boolean {
  const isOwner = useIsOwner();
  const canView = useAuthStore((s) => !!s.currentUser?.canViewFinancials);
  return isOwner || canView;
}
