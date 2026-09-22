/**
 * Actual Hours — read-only view of timesheet actuals.
 *
 * Source of truth: the /my-time portal. Users submit their weekly time,
 * managers approve, and the rows land in `time_entries`. The
 * `unified_actual_hours` SQL view reads submitted + approved rows and
 * exposes them here in the shape the People / Projects / Table /
 * vs Forecast tabs already use.
 *
 * Zoho People sync was retired on 2026-08-22. Historical Zoho rows for
 * dates strictly before 2026-08-01 are still stitched in by the view so
 * June and July aren't blanked out during the mid-July cutover, but from
 * August forward this page shows only what people submitted through
 * /my-time.
 */
import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
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
  const usedLegacyFallback = useActualHoursStore((s) => s.usedLegacyFallback);

  const [tab, setTab] = useState<TabKey>(() => loadTab());
  useEffect(() => {
    try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  const memberCount = new Set(entries.map((e) => e.employeeName)).size;
  const projectCount = new Set(entries.map((e) => e.project).filter(Boolean)).size;

  return (
    <>
      <PageHeader
        title="Actual Hours"
        subtitle={
          entries.length > 0
            ? `${entries.length.toLocaleString()} timesheet entries · ${memberCount} people · ${projectCount} projects · sourced from /my-time submissions`
            : 'Actuals will appear here as people submit and managers approve time in /my-time.'
        }
      />

      <Card>
        {/* Sub-tabs — mirrors TeamRosterPage */}
        <div className="flex items-center justify-between gap-3 mb-4 border-b border-line -mx-5 px-5">
          <div className="flex items-center gap-1">
            <TabButton active={tab === 'people'} onClick={() => setTab('people')}>People</TabButton>
            <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}>Projects</TabButton>
            <TabButton active={tab === 'table'} onClick={() => setTab('table')}>Table</TabButton>
            <TabButton active={tab === 'forecast'} onClick={() => setTab('forecast')}>vs Forecast</TabButton>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <span className="text-[11px] text-muted/70 hidden md:flex items-center gap-1">
              <Clock size={12} />
              From /my-time · Aug 2026 forward
            </span>
          </div>
        </div>

        {usedLegacyFallback && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The <code>unified_actual_hours</code> view could not be read, so the People, Projects and
            Table tabs below fell back to the legacy <code>actual_hours</code> table — Zoho history
            only, missing everything submitted through /my-time. The browser console has the error.
            (vs Forecast reads <code>time_entries</code> directly and is unaffected.)
          </p>
        )}

        {entries.length === 0 && tab !== 'forecast' ? (
          <EmptyState />
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
        active ? 'text-primary' : 'text-muted hover:text-ink/80'
      }`}
    >
      {children}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Clock size={26} />
      </div>
      <h3 className="text-base font-bold text-ink mb-1">No actuals yet</h3>
      <p className="text-sm text-muted max-w-md mb-4">
        Actuals populate as team members submit timesheets in <strong>/my-time</strong> and
        managers approve them. Nothing else to do here.
      </p>
    </div>
  );
}
