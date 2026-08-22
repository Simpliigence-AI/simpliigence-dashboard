/**
 * Owner-only gate — hides financial data (cost, bill rate, margin, revenue)
 * from everyone except Raghu, regardless of role.
 *
 * Role-based gating isn't enough here: other admins can see the app but
 * shouldn't see per-consultant cost/bill economics. The gate is keyed off
 * the authenticated user's email against a small owner allowlist.
 *
 * Two aliases exist on `authorized_users`, so both are recognised:
 *   raghu.seetharam@simpliigence.com  (canonical)
 *   raghu@simpliigence.com            (short alias)
 */
import type { ReactNode } from 'react';
import { useAuthStore } from '../store/useAuthStore';

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
 * Renders children unchanged for the owner; otherwise renders a masked
 * placeholder (••• by default). Use around any cost / bill rate / margin
 * / revenue value displayed in the UI.
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
  const isOwner = useIsOwner();
  if (isOwner) return <>{children}</>;
  return (
    <span
      title="Financial data — visible to owner only"
      className={`text-muted/70 italic font-medium tracking-wider select-none ${className}`}
    >
      {placeholder ?? '•••'}
    </span>
  );
}

/**
 * Hook variant for tickFormatter / Tooltip callbacks / table cell text
 * where JSX wrapping isn't possible. Pass any pre-formatted string; returns
 * '•••' when the current user isn't the owner.
 */
export function useMaskForNonOwner() {
  const isOwner = useIsOwner();
  return (value: string | number): string => {
    if (isOwner) return typeof value === 'number' ? value.toLocaleString() : value;
    return '•••';
  };
}
