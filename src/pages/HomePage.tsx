/**
 * HomePage — role-oriented landing page.
 *
 * The sidebar exposes every page flat, which is fine once you know the tool
 * but is overwhelming for new hires. This page gives each team (Sales,
 * Delivery, Talent, Operations, Concierge, Admin) a single tab with the
 * pages they actually touch, so someone joining the TA team can land here
 * and immediately see the four surfaces relevant to them.
 *
 * No new data model — this is pure navigation. Cards link into the same
 * routes as the sidebar.
 */
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users, UserPlus, UserCog,
  Building2, Handshake, Target,
  Headset, Sparkles,
  ClipboardList, Globe,
  CalendarCheck, Contact, FileEdit, BarChart3,
  FolderKanban, Layers, Clock, TrendingUp, DollarSign,
  Activity, History,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useForecastStore, usePipelineStore } from '../store';
import { MONTHS } from '../types/forecast';

/**
 * Categorical accents. One flat token per hub rather than a gradient pair —
 * gradients on 30 small cards turn the page into a swatch book, and the hue is
 * doing identification work, not decoration.
 */
type AccentKey = 'blue' | 'green' | 'gold' | 'violet' | 'teal' | 'rose' | 'navy';

const ACCENT: Record<AccentKey, { chip: string; icon: string; hover: string }> = {
  blue:   { chip: 'bg-brand/10',  icon: 'text-brand',   hover: 'group-hover:text-brand' },
  green:  { chip: 'bg-green/10',  icon: 'text-green',   hover: 'group-hover:text-green' },
  gold:   { chip: 'bg-gold/12',   icon: 'text-gold',    hover: 'group-hover:text-gold' },
  violet: { chip: 'bg-violet/10', icon: 'text-violet',  hover: 'group-hover:text-violet' },
  teal:   { chip: 'bg-teal/10',   icon: 'text-teal',    hover: 'group-hover:text-teal' },
  rose:   { chip: 'bg-rose/10',   icon: 'text-rose',    hover: 'group-hover:text-rose' },
  navy:   { chip: 'bg-navy/8',    icon: 'text-navy',    hover: 'group-hover:text-navy' },
};

interface HubLink {
  to: string;
  icon: LucideIcon;
  label: string;
  desc: string;
}
interface Hub {
  key: string;
  label: string;
  tagline: string;
  /** Categorical token — keys into ACCENT below. */
  accent: AccentKey;
  icon: LucideIcon;
  links: HubLink[];
  adminOnly?: boolean;
}

const HUBS: Hub[] = [
  {
    key: 'sales',
    label: 'Sales & Growth',
    tagline: 'Accounts, partnerships, and go-to-market motion',
    accent: 'green',
    icon: TrendingUp,
    links: [
      { to: '/accounts',    icon: Building2, label: 'Accounts',        desc: 'Client accounts, sales + delivery connects, forecast vs secured' },
      { to: '/gtm-list',    icon: Target,    label: 'GTM List',        desc: 'Strategic partnership targets — assignees, contacts, action items' },
      { to: '/pipeline',    icon: Layers,    label: 'Pipeline Projects', desc: 'Pre-sales / pipeline projects in flight' },
    ],
  },
  {
    key: 'delivery',
    label: 'Delivery',
    tagline: 'Active projects, utilization, and hours',
    accent: 'blue',
    icon: FolderKanban,
    links: [
      { to: '/projects',      icon: FolderKanban, label: 'Current Projects',    desc: 'Delivery projects in flight' },
      { to: '/team',          icon: Users,        label: 'Project Team',        desc: 'Team allocations by project' },
      { to: '/actual-hours',  icon: Clock,        label: 'Actual Hours',        desc: 'Recorded billable hours by person + project' },
      { to: '/forecasting',   icon: TrendingUp,   label: 'Utilization Forecast', desc: 'Bench + billable forecast across the roster' },
      { to: '/financials',    icon: DollarSign,   label: 'Financials',          desc: 'Revenue, margin, and P&L rollups' },
    ],
  },
  {
    key: 'talent',
    label: 'Talent Acquisition',
    tagline: 'Recruiting, candidates, and hiring plan',
    accent: 'violet',
    icon: Users,
    links: [
      { to: '/ta-daily-log',        icon: CalendarCheck, label: 'TA Daily Log',       desc: 'Daily recruiting activity log across the TA team' },
      { to: '/ta-metrics',          icon: BarChart3,     label: 'TA Metrics',         desc: 'Team-level TA KPIs and trends' },
      { to: '/candidates',          icon: Contact,       label: 'Candidates',         desc: 'Candidate database with Ask Claude search' },
      { to: '/vendors',             icon: Handshake,     label: 'Vendors',            desc: 'TA vendor directory — staffing + recruiting partners' },
      { to: '/profile-format',      icon: FileEdit,      label: 'Profile Format',     desc: 'Resume reformatter + parser' },
      { to: '/india-hiring-forecast', icon: UserPlus,    label: 'Hiring Forecast (India)', desc: 'India hiring plan vs demand' },
      { to: '/hiring-forecast',     icon: UserPlus,      label: 'Hiring Forecast (Global)', desc: 'Global hiring plan vs demand' },
    ],
  },
  {
    key: 'india_tm',
    label: 'India T&M',
    tagline: 'India staffing operations',
    accent: 'gold',
    icon: Globe,
    links: [
      { to: '/india-staffing',        icon: ClipboardList, label: 'India Demand',    desc: 'Open positions + demand pipeline (India)' },
      { to: '/india-roster',          icon: Users,         label: 'India Roster',    desc: 'Every India billable + bench resource' },
      { to: '/india-hiring-forecast', icon: UserPlus,      label: 'Hiring Forecast', desc: 'Weekly demand vs supply for India hiring' },
    ],
  },
  {
    key: 'us_tm',
    label: 'Global T&M',
    tagline: 'Global staffing operations',
    accent: 'teal',
    icon: Globe,
    links: [
      { to: '/us-staffing', icon: Globe, label: 'Global Demand', desc: 'Open positions + demand pipeline' },
      { to: '/us-roster',   icon: Users, label: 'Global Roster', desc: 'Every billable + bench resource' },
    ],
  },
  {
    key: 'concierge',
    label: 'Concierge',
    tagline: 'Managed-services accounts + AI account planning',
    accent: 'violet',
    icon: Headset,
    links: [
      { to: '/concierge', icon: Headset,   label: 'Concierge',          desc: 'Accounts, tickets, feature coverage, AI profile + opportunities' },
      { to: '/concierge', icon: Sparkles,  label: 'Concierge AI Query', desc: 'Ask cross-account questions on the Concierge homepage' },
    ],
  },
  {
    key: 'personal',
    label: 'Personal',
    tagline: 'Your day-to-day',
    accent: 'navy',
    icon: LayoutDashboard,
    links: [
      { to: '/',            icon: LayoutDashboard, label: 'Dashboard',    desc: 'Company-wide KPIs and quick links' },
      { to: '/my-time',     icon: Clock,           label: 'My Time',      desc: 'Log and edit your own time entries' },
      { to: '/team-time',   icon: Clock,           label: 'Team Time',    desc: 'Approve time for your reports' },
    ],
  },
  {
    key: 'admin',
    label: 'Admin',
    tagline: 'User management + audit trail',
    accent: 'navy',
    icon: UserCog,
    adminOnly: true,
    links: [
      { to: '/admin/users',    icon: UserCog,  label: 'Users',    desc: 'Manage authorized users, roles, permissions' },
      { to: '/admin/activity', icon: Activity, label: 'Activity', desc: 'Team activity feed' },
      { to: '/admin/audit',    icon: History,  label: 'Audit Log', desc: 'Immutable change log across the app' },
    ],
  },
];

export default function HomePage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const assignments = useForecastStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const isAdmin = !!currentUser?.isAdmin;

  const visibleHubs = useMemo(
    () => HUBS.filter((h) => !h.adminOnly || isAdmin),
    [isAdmin],
  );

  const [tab, setTab] = useState<string>('all');

  const displayed = tab === 'all' ? visibleHubs : visibleHubs.filter((h) => h.key === tab);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = currentUser?.fullName?.split(' ')[0] ?? '';

  const linkCount = useMemo(
    () => visibleHubs.reduce((n, h) => n + h.links.length, 0),
    [visibleHubs],
  );

  /**
   * The at-a-glance line. Deliberately a sentence with the numbers set in
   * bold rather than a row of stat tiles: tiles make you read four things and
   * work out the story yourself, a sentence hands you the story and lets the
   * numbers carry the emphasis.
   *
   * Scoped to the CURRENT month only — a year-to-date figure on a landing page
   * is trivia, this month is something you can still act on.
   */
  const snapshot = useMemo(() => {
    const month = MONTHS[new Date().getMonth()];
    const archived = new Set(
      pipelineProjects.filter((p) => p.status === 'Archived')
        .map((p) => (p.forecastName || p.name).toLowerCase()),
    );
    const projects = new Set<string>();
    const people = new Set<string>();
    let hours = 0;
    for (const a of assignments) {
      const h = a.monthlyTotals?.[month] ?? 0;
      if (h <= 0 || !a.project || archived.has(a.project.toLowerCase())) continue;
      projects.add(a.project);
      people.add(a.employeeName);
      hours += h;
    }
    return { month, projects: projects.size, people: people.size, hours: Math.round(hours) };
  }, [assignments, pipelineProjects]);

  return (
    <div>
      {/* Hero — scale carries the hierarchy, so no card, no border, no chrome. */}
      <header className="mb-8">
        <p className="eyebrow">Simpliigence · Delivery cockpit</p>
        <h1 className="display-xl text-ink mt-2">
          {greeting}
          {firstName && <span className="text-brand">, {firstName}</span>}
        </h1>
        <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-muted">
          Pick a team to see the pages you actually need. All{' '}
          <span className="font-bold text-ink">{linkCount}</span> are still one click away in the sidebar.
        </p>
      </header>

      {/* At-a-glance — the reference's "read this first" band, in brand navy. */}
      {snapshot.projects > 0 && (
        <div className="mb-8 rounded-2xl bg-navy text-white/90 px-6 py-5 shadow-[0_16px_48px_#0f1b2d29] flex flex-col sm:flex-row sm:items-center gap-4">
          <span className="eyebrow !text-white/45 shrink-0 sm:w-28">This month</span>
          <p className="text-[0.9375rem] leading-relaxed">
            <span className="font-bold text-white">{snapshot.projects} projects</span> in flight with{' '}
            <span className="font-bold text-white">{snapshot.people} people</span> allocated, totalling{' '}
            <span className="font-bold text-white">{snapshot.hours.toLocaleString()} hours</span> booked across{' '}
            {snapshot.month}. Pod-level utilisation and who&apos;s on leave are on{' '}
            <NavLink to="/team" className="font-bold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Project Team
            </NavLink>.
          </p>
        </div>
      )}

      {/* Team tabs */}
      <div className="mb-8 -mx-1 overflow-x-auto">
        <div className="flex items-center gap-1 px-1 min-w-max">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} label={`All (${visibleHubs.length})`} />
          {visibleHubs.map((h) => (
            <TabButton key={h.key} active={tab === h.key} onClick={() => setTab(h.key)} label={h.label} Icon={h.icon} />
          ))}
        </div>
      </div>

      {/* Hubs */}
      <div className="space-y-10">
        {displayed.map((hub) => <HubBlock key={hub.key} hub={hub} />)}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, label, Icon }: { active: boolean; onClick: () => void; label: string; Icon?: LucideIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-2 rounded-full text-[0.8125rem] font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
        active
          ? 'bg-navy text-white shadow-[0_6px_18px_#0f1b2d29]'
          : 'bg-surface border border-line text-ink/75 hover:border-brand/50 hover:text-ink'
      }`}
    >
      {Icon && <Icon size={15} className={active ? 'text-white' : 'text-muted'} />}
      {label}
    </button>
  );
}

function HubBlock({ hub }: { hub: Hub }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-11 h-11 rounded-xl ${ACCENT[hub.accent].chip} ${ACCENT[hub.accent].icon} flex items-center justify-center shrink-0`}>
          <hub.icon size={22} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h2 className="display-md text-ink">{hub.label}</h2>
          <p className="text-[0.8125rem] text-muted truncate">{hub.tagline}</p>
        </div>
        <span className="ml-auto shrink-0 text-[0.6875rem] font-bold text-muted tabular-nums bg-surface-2 rounded-full px-2.5 py-1">
          {hub.links.length}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {hub.links.map((l) => <HubCard key={`${hub.key}-${l.to}-${l.label}`} link={l} accent={hub.accent} />)}
      </div>
    </section>
  );
}

function HubCard({ link, accent }: { link: HubLink; accent: AccentKey }) {
  const a = ACCENT[accent];
  return (
    <NavLink to={link.to} className="group h-full">
      <div className="h-full bg-surface rounded-2xl border border-line/70 p-5 shadow-[0_16px_48px_#0f1b2d0f] transition-all duration-150 group-hover:-translate-y-0.5 group-hover:shadow-[0_20px_56px_#0f1b2d24] group-hover:border-line">
        <div className="flex items-start gap-3.5">
          {/* Bigger icon — at 16px these read as decoration; at 22px they're
              the thing you actually scan the grid by. */}
          <div className={`w-11 h-11 rounded-xl ${a.chip} ${a.icon} flex items-center justify-center flex-shrink-0`}>
            <link.icon size={22} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`text-[0.9375rem] font-bold text-ink flex items-center gap-1.5 transition-colors ${a.hover}`}>
              {link.label}
              <ArrowRight size={14} className="text-line group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="text-[0.8125rem] text-muted mt-1 leading-relaxed">{link.desc}</div>
          </div>
        </div>
      </div>
    </NavLink>
  );
}
