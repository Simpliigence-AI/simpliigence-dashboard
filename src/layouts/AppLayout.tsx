import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { DemoBanner } from '../components/DemoBanner';
import { RouteTracker } from '../components/RouteTracker';

const SIDEBAR_KEY = 'sidebar-collapsed';

/**
 * Responsive shell.
 *  - Desktop (md+): fixed sidebar at left (collapsible to 68px); main has
 *    a matching left margin so nothing slides under it.
 *  - Mobile (<md):  sidebar is off-canvas by default; a hamburger button
 *    over the content opens it as a drawer with a tap-to-dismiss backdrop.
 *    Main content has no left margin and uses the full viewport width.
 */
export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

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

      <main className={`flex-1 ml-0 ${collapsed ? 'md:ml-[68px]' : 'md:ml-60'} transition-[margin] duration-300 ease-in-out`}>
        <DemoBanner />

        {/* Mobile hamburger — overlays the content area, only visible on <md */}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="md:hidden fixed top-3 left-3 z-20 inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white shadow-md border border-slate-200 text-slate-700 hover:bg-slate-50"
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>

        <div className="p-4 pt-16 md:p-6 md:pt-6 lg:p-8 bg-surface min-h-screen">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
