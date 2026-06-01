/**
 * Generic role-gated route wrapper.
 *
 * Bounces users whose role is NOT in `allow` back to `fallback` (default `/`).
 * Used to enforce role-based route access at the UI layer alongside Supabase
 * RLS — e.g. wrap /financials in `<RoleOnly allow={['admin']}>` so a TA
 * Manager typing the URL directly is redirected away.
 *
 * Auth profile may not be ready on first paint — render a tiny placeholder
 * during `loading` so we don't false-redirect mid-load.
 */
import { Navigate } from 'react-router-dom';
import { useAuthStore, type UserRole } from '../store/useAuthStore';

export function RoleOnly({ allow, fallback = '/', children }: {
  allow: UserRole[];
  fallback?: string;
  children: React.ReactNode;
}) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Checking permissions…
      </div>
    );
  }
  if (!role || !allow.includes(role)) {
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
}
