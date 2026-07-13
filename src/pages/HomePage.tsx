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
  Users, UserCheck, UserPlus, UserCog,
  Building2, Handshake, Target,
  Headset, Sparkles,
  ClipboardList, Globe,
  CalendarCheck, Contact, FileEdit, BarChart3,
  FolderKanban, Layers, Clock, TrendingUp, DollarSign,
  Activity, History,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';

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
  accent: string;             // Tailwind gradient color pair
  icon: LucideIcon;
  links: HubLink[];
  adminOnly?: boolean;
}

const HUBS: Hub[] = [
  {
    key: 'sales',
    label: 'Sales & Growth',
    tagline: 'Accounts, partnerships, and go-to-market motion',
    accent: 'from-emerald-500 to-sky-500',
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
    accent: 'from-sky-500 to-indigo-500',
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
    accent: 'from-fuchsia-500 to-purple-500',
    icon: Users,
    links: [
      { to: '/ta-daily-log',        icon: CalendarCheck, label: 'TA Daily Log',       desc: 'Daily recruiting activity log across the TA team' },
      { to: '/ta-metrics',          icon: BarChart3,     label: 'TA Metrics',         desc: 'Team-level TA KPIs and trends' },
      { to: '/candidates',          icon: Contact,       label: 'Candidates',         desc: 'Candidate database with Ask Claude search' },
      { to: '/vendors',             icon: Handshake,     label: 'Vendors',            desc: 'TA vendor directory — staffing + recruiting partners' },
      { to: '/profile-format',      icon: FileEdit,      label: 'Profile Format',     desc: 'Resume reformatter + parser' },
      { to: '/india-hiring-forecast', icon: UserPlus,    label: 'Hiring Forecast (India)', desc: 'India hiring plan vs demand' },
      { to: '/hiring-forecast',     icon: UserPlus,      label: 'Hiring Forecast (US)',    desc: 'US hiring plan vs demand' },
    ],
  },
  {
    key: 'india_tm',
    label: 'India T&M',
    tagline: 'India staffing operations',
    accent: 'from-amber-500 to-rose-500',
    icon: Globe,
    links: [
      { to: '/india-staffing',        icon: ClipboardList, label: 'India Demand',    desc: 'Open positions + demand pipeline (India)' },
      { to: '/india-roster',          icon: Users,         label: 'India Roster',    desc: 'Every India billable + bench resource' },
      { to: '/india-hiring-forecast', icon: UserPlus,      label: 'Hiring Forecast', desc: 'Weekly demand vs supply for India hiring' },
    ],
  },
  {
    key: 'us_tm',
    label: 'US T&M',
    tagline: 'US staffing operations',
    accent: 'from-red-500 to-orange-500',
    icon: Globe,
    links: [
      { to: '/us-staffing', icon: Globe,     label: 'US Demand',   desc: 'Open positions + demand pipeline (US)' },
      { to: '/us-roster',   icon: Users,     label: 'US Roster',   desc: 'Every US billable + bench resource' },
      { to: '/open-bench',  icon: UserCheck, label: 'Open Bench',  desc: 'Available consultants — searchable bench' },
    ],
  },
  {
    key: 'concierge',
    label: 'Concierge',
    tagline: 'Managed-services accounts + AI account planning',
    accent: 'from-purple-500 to-sky-500',
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
    accent: 'from-slate-500 to-slate-700',
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
    accent: 'from-slate-600 to-slate-900',
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

  return (
    <div>
      <PageHeader
        title={firstName ? `${greeting}, ${firstName}` : 'Home'}
        subtitle="Pick a team to see the pages you actually need. Everything is still one click away in the sidebar."
      />

      {/* Team tabs */}
      <div className="mb-6 -mx-1 overflow-x-auto">
        <div className="flex items-center gap-1 px-1 min-w-max">
          <TabButton active={tab === 'all'} onClick={() => setTab('all')} label={`All (${visibleHubs.length})`} />
          {visibleHubs.map((h) => (
            <TabButton key={h.key} active={tab === h.key} onClick={() => setTab(h.key)} label={h.label} Icon={h.icon} />
          ))}
        </div>
      </div>

      {/* Hubs */}
      <div className="space-y-6">
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
      className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
        active
          ? 'bg-slate-900 text-white shadow-sm'
          : 'bg-white border border-slate-200 text-slate-700 hover:border-slate-400'
      }`}
    >
      {Icon && <Icon size={12} className={active ? 'text-white' : 'text-slate-500'} />}
      {label}
    </button>
  );
}

function HubBlock({ hub }: { hub: Hub }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${hub.accent} text-white flex items-center justify-center shadow-sm`}>
          <hub.icon size={16} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">{hub.label}</h2>
          <p className="text-[11px] text-slate-500 truncate">{hub.tagline}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {hub.links.map((l) => <HubCard key={`${hub.key}-${l.to}-${l.label}`} link={l} accent={hub.accent} />)}
      </div>
    </section>
  );
}

function HubCard({ link, accent }: { link: HubLink; accent: string }) {
  return (
    <NavLink to={link.to} className="group">
      <Card className="h-full transition-all duration-150 group-hover:border-slate-300 group-hover:shadow-md">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${accent} text-white flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <link.icon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-1 group-hover:text-sky-700 transition-colors">
              {link.label}
              <ArrowRight size={11} className="text-slate-300 group-hover:text-sky-500 group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{link.desc}</div>
          </div>
        </div>
      </Card>
    </NavLink>
  );
}
