import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { DemoBanner } from '../components/DemoBanner';
import { RouteTracker } from '../components/RouteTracker';

const SIDEBAR_KEY = 'sidebar-collapsed';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === 'true'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, String(collapsed)); } catch {}
  }, [collapsed]);

  return (
    <div className="flex min-h-screen">
      <RouteTracker />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <main className={`flex-1 ${collapsed ? 'ml-[68px]' : 'ml-60'} transition-[margin] duration-300 ease-in-out`}>
        <DemoBanner />
        <div className="p-6 lg:p-8 bg-surface min-h-screen">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
