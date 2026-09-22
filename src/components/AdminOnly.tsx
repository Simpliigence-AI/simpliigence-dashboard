/**
 * Route guard for /admin/* pages. Redirects non-admins to the dashboard root.
 * Shows a tiny spinner while the auth profile is still loading on first paint.
 */
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

export function AdminOnly({ children }: { children: React.ReactNode }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const loading = useAuthStore((s) => s.loading);

  // Cold start only — a background refresh must not unmount the page.
  if (loading && !currentUser) {
    return (
      <div className="flex items-center justify-center py-20 text-muted/70 text-sm">
        Checking permissions…
      </div>
    );
  }
  if (!currentUser?.isAdmin) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
