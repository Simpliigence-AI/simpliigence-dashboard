/**
 * Financial visibility gate — used to be strictly owner-only, now respects
 * the session reveal + can_view_financials permission the same way
 * <Sensitive> does.
 *
 * Kept as a separate export so existing call sites don't have to change
 * their imports. Behaviour is now equivalent to <Sensitive> — masked for
 * everyone by default, click any masked value to reveal for the session
 * (only if the current user has can_view_financials or is the owner).
 * Owner is still the ONE user who always has permission, so nothing they
 * see today gets hidden from them.
 */
import type { ReactNode } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { Sensitive, useMaskFinancial as useMaskFinancialUnderlying } from './Sensitive';

const OWNER_EMAILS = new Set<string>([
  'raghu.seetharam@simpliigence.com',
  'raghu@simpliigence.com',
]);

/** True iff the signed-in user is the owner (Raghu). */
export function useIsOwner(): boolean {
  const email = useAuthStore((s) => s.currentUser?.email);
  if (!email) return false;
  return OWNER_EMAILS.has(email.toLowerCase());
}

/**
 * Delegates to <Sensitive>. Kept as a separate name so existing call
 * sites (Global Roster, USRosterPage, USRosterCardGrid, AssignmentEditor,
 * USRosterClientView, USRosterConsultantView) don't need to change.
 */
export function OwnerOnly({
  children,
  placeholder,
  className = '',
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  className?: string;
}) {
  return (
    <Sensitive placeholder={placeholder} className={className}>
      {children}
    </Sensitive>
  );
}

/** Hook variant — masked-unless-revealed for the same rules. */
export function useMaskForNonOwner() {
  return useMaskFinancialUnderlying();
}
