/**
 * Route gate for role='employee' users.
 *
 * When applied to the root index route, an employee landing on `/` is
 * redirected to `/my-time` (their only authorized page). Admins/managers
 * see the wrapped child unchanged.
 */
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';

export function EmployeeRedirect({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const loading = useAuthStore((s) => s.loading);

  if (loading) return null; // wait for auth profile before deciding
  if (role === 'employee') return <Navigate to="/my-time" replace />;
  return <>{children}</>;
}
