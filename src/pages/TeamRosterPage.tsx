import { useEffect, useState } from 'react';
import { useForecastStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import PeopleView from './team/PeopleView';
import ProjectsView from './team/ProjectsView';
import TableView from './team/TableView';

type TeamTab = 'people' | 'projects' | 'table';

const TAB_KEY = 'team-view-tab';

function loadTab(): TeamTab {
  if (typeof window === 'undefined') return 'people';
  const v = window.localStorage.getItem(TAB_KEY);
  return v === 'projects' || v === 'table' ? v : 'people';
}

export default function TeamRosterPage() {
  const assignments = useForecastStore((s) => s.assignments);
  const [tab, setTab] = useState<TeamTab>(() => loadTab());

  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore quota / private mode errors */
    }
  }, [tab]);

  const memberCount = new Set(assignments.map((a) => a.employeeName)).size;
  const projectCount = new Set(assignments.map((a) => a.project)).size;

  return (
    <>
      <PageHeader
        title="Project Team"
        subtitle={`${memberCount} team members · ${projectCount} projects · ${assignments.length} allocations`}
      />

      <Card>
        <div className="flex items-center gap-1 mb-4 border-b border-slate-200 -mx-5 px-5">
          <TabButton active={tab === 'people'} onClick={() => setTab('people')}>People</TabButton>
          <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}>Projects</TabButton>
          <TabButton active={tab === 'table'} onClick={() => setTab('table')}>Table</TabButton>
        </div>

        {tab === 'people' && <PeopleView />}
        {tab === 'projects' && <ProjectsView />}
        {tab === 'table' && <TableView />}
      </Card>
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
