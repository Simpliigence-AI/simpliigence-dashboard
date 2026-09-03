import { useState, useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { DemoBanner } from '../components/DemoBanner';
import { RouteTracker } from '../components/RouteTracker';
import { useAuthStore } from '../store/useAuthStore';
import { useTimeMode } from '../hooks/useTimeMode';

/** Paths that role='employee' is allowed to visit. Anything else redirects
 *  them to /my-time. Keeps the URL-typing escape hatch closed without having
 *  to wrap every route individually with RoleOnly. */
const EMPLOYEE_ALLOWED_PATHS = new Set<string>(['/my-time', '/leave', '/concierge']);

const SIDEBAR_KEY = 'sidebar-collapsed';

/**
 * Responsive shell.
 *  - Desktop (md+): fixed sidebar at left, 288px wide (collapsible to 76px);
 *    main has
 *    a matching left margin so nothing slides under it.
 *  - Mobile (<md):  sidebar is off-canvas by default; a hamburger button
 *    over the content opens it as a drawer with a tap-to-dismiss backdrop.
 *    Main content has no left margin and uses the full viewport width.
 */
export default function AppLayout() {
  // App-wide time-of-day theme: light 06:00–18:00, dark otherwise.
  // The hook sets `<html data-mode="…">` and CSS in index.css takes care of
  // flipping every semantic token (--color-paper / --color-surface / …).
  useTimeMode();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const role = useAuthStore((s) => s.currentUser?.role);
  const authLoading = useAuthStore((s) => s.loading);
  const hasProfile = useAuthStore((s) => s.currentUser !== null);
  // Block the page ONLY on a cold start. A background profile refresh (which
  // Supabase triggers on tab focus and on every token refresh) must never
  // unmount <Outlet /> — that is what wiped in-progress edits.
  const gateOnAuth = authLoading && !hasProfile;

  // Hard lockdown: role='employee' may only visit EMPLOYEE_ALLOWED_PATHS.
  // Any other URL (typed, bookmarked, deep-linked) bounces back to /my-time.
  const isEmployeeBlocked = role === 'employee' && !EMPLOYEE_ALLOWED_PATHS.has(location.pathname);

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <RouteTracker />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <main className={`flex-1 ml-0 ${collapsed ? 'md:ml-[76px]' : 'md:ml-72'} transition-[margin] duration-300 ease-in-out`}>
        <DemoBanner />

        {/* Mobile hamburger — overlays the content area, only visible on <md */}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="md:hidden fixed top-3 left-3 z-20 inline-flex items-center justify-center w-10 h-10 rounded-lg bg-surface shadow-md border border-line text-ink/80 hover:bg-surface-2/70"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>

        <div className="p-4 pt-16 md:p-6 md:pt-6 lg:p-8 bg-surface min-h-screen">
          {gateOnAuth ? (
            <div className="text-sm text-muted/70 text-center py-20">Checking permissions…</div>
          ) : isEmployeeBlocked ? (
            <Navigate to="/my-time" replace />
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  );
}
