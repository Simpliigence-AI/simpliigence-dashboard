/**
 * Actual Hours page — read-only view of timesheet data synced from Zoho People.
 *
 * Mirrors the layout of TeamRosterPage so the People / Projects / Table sub-tabs
 * feel like siblings: Project Team shows the forecast plan, this page shows the
 * actuals that were logged. A fourth "vs Forecast" tab compares them.
 *
 * Source of truth: Zoho People Timetracker, refreshed via the `zoho-people-sync`
 * Supabase edge function. The "Sync from Zoho People" button at the top of the
 * page triggers a re-sync; data is cached in Supabase and localStorage between
 * syncs.
 */
import { useEffect, useState } from 'react';
import { Clock, Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useActualHoursStore } from '../store';
import PeopleView from './actuals/PeopleView';
import ProjectsView from './actuals/ProjectsView';
import TableView from './actuals/TableView';
import ForecastVsActualView from './actuals/ForecastVsActualView';

type TabKey = 'people' | 'projects' | 'table' | 'forecast';
const TAB_KEY = 'actual-hours-tab';

function loadTab(): TabKey {
  if (typeof window === 'undefined') return 'people';
  const v = window.localStorage.getItem(TAB_KEY);
  return v === 'projects' || v === 'table' || v === 'forecast' ? v : 'people';
}

export default function ActualHoursPage() {
  const entries = useActualHoursStore((s) => s.entries);
  const lastSync = useActualHoursStore((s) => s.lastZohoSync);
  const syncFromZohoPeople = useActualHoursStore((s) => s.syncFromZohoPeople);

  const [tab, setTab] = useState<TabKey>(() => loadTab());
  useEffect(() => {
    try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const memberCount = new Set(entries.map((e) => e.employeeName)).size;
  const projectCount = new Set(entries.map((e) => e.project).filter(Boolean)).size;

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const r = await syncFromZohoPeople();
    setSyncing(false);
    if (r.ok) {
      const range = r.range ? ` (${r.range.from} → ${r.range.to})` : '';
      setSyncMsg(`Synced ${r.count ?? 0} entries${range}.`);
    } else {
      setSyncMsg(`Sync failed: ${r.error ?? 'unknown error'}`);
    }
    setTimeout(() => setSyncMsg(null), 6000);
  };

  return (
    <>
      <PageHeader
        title="Actual Hours"
        subtitle={
          entries.length > 0
            ? `${entries.length.toLocaleString()} timesheet entries · ${memberCount} people · ${projectCount} projects · YTD`
            : 'Sync from Zoho People to populate this view.'
        }
      />

      <Card>
        {/* Sub-tabs — mirrors TeamRosterPage */}
        <div className="flex items-center justify-between gap-3 mb-4 border-b border-slate-200 -mx-5 px-5">
          <div className="flex items-center gap-1">
            <TabButton active={tab === 'people'} onClick={() => setTab('people')}>People</TabButton>
            <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}>Projects</TabButton>
            <TabButton active={tab === 'table'} onClick={() => setTab('table')}>Table</TabButton>
            <TabButton active={tab === 'forecast'} onClick={() => setTab('forecast')}>vs Forecast</TabButton>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {lastSync && (
              <span className="text-[11px] text-slate-400 hidden md:flex items-center gap-1">
                <Clock size={12} />
                Last synced {new Date(lastSync).toLocaleString()}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync from Zoho People
            </button>
          </div>
        </div>

        {syncMsg && (
          <div
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${
              syncMsg.startsWith('Sync failed')
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            {syncMsg}
          </div>
        )}

        {entries.length === 0 && tab !== 'forecast' ? (
          <EmptyState onSync={handleSync} syncing={syncing} />
        ) : tab === 'people' ? (
          <PeopleView />
        ) : tab === 'projects' ? (
          <ProjectsView />
        ) : tab === 'table' ? (
          <TableView />
        ) : (
          <ForecastVsActualView />
        )}
      </Card>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? 'text-primary' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />
      )}
    </button>
  );
}

function EmptyState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Clock size={26} />
      </div>
      <h3 className="text-base font-bold text-slate-800 mb-1">No actuals synced yet</h3>
      <p className="text-sm text-slate-500 max-w-md mb-4">
        Click <strong>Sync from Zoho People</strong> to pull this year's timesheet entries.
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
      >
        {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Sync from Zoho People
      </button>
    </div>
  );
}
