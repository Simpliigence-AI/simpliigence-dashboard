/**
 * Single source of truth for app navigation.
 *
 * The sidebar, the ⌘K command palette and the Home page all render from
 * these groups, so a page only has to be added (or retired) in one place.
 * Role, tab-permission, access-matrix and financials filtering happen in
 * `useNavSections()` — this file is pure data.
 */
import {
  LayoutDashboard, Users, FolderKanban, Layers, DollarSign, UserPlus, Headset,
  ClipboardList, Globe, TrendingUp, Clock, Timer, CheckSquare, CalendarCheck,
  Contact, BarChart3, PieChart, Building2, Handshake, Target, Radar,
  ClipboardCheck, Home, FileEdit, UserCog, Activity, History, ShieldCheck,
  PhoneCall, ListChecks, Briefcase, AppWindow,
  type LucideIcon,
} from 'lucide-react';

export type NavRole = 'admin' | 'manager' | 'employee';

/** Colour per group. Used for the sidebar dot / active bar and the Home cards. */
export type NavAccent =
  | 'blue' | 'sky' | 'indigo' | 'violet' | 'amber' | 'teal' | 'emerald' | 'rose' | 'slate';

export interface NavItem {
  to?: string;
  /** External link — opens a new tab. */
  href?: string;
  icon: LucideIcon;
  label: string;
  /** One-liner shown on the Home page card. Items without one are sidebar-only. */
  desc?: string;
  /** Limit to these roles. Omitted = every role that can see the group. */
  roles?: NavRole[];
  /** Hidden unless financials are revealed (sidebar "Financials hidden" toggle). */
  financial?: boolean;
  /** Also shown to non-admins who hold this tab permission. */
  tabKey?: string;
  /** Extra words the ⌘K search should match. */
  keywords?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  tagline: string;
  accent: NavAccent;
  icon: LucideIcon;
  /** Roles that see this group at all. */
  roles: NavRole[];
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'home', label: 'Home', tagline: 'Start here', accent: 'blue', icon: Home,
    roles: ['admin', 'manager'],
    items: [
      { to: '/home',     icon: Home,            label: 'Home' },
      { to: '/',         icon: LayoutDashboard, label: 'Dashboard', desc: 'Company-wide KPIs and quick links' },
      { to: '/checkins', icon: ClipboardCheck,  label: 'Check-ins', desc: 'Monthly scorecards and KPI check-ins' },
    ],
  },
  {
    key: 'mywork', label: 'My Work', tagline: 'Your time, leave and approvals', accent: 'sky', icon: Timer,
    roles: ['admin', 'manager', 'employee'],
    items: [
      { to: '/my-time',       icon: Timer,         label: 'My Time',    desc: 'Log and edit your own time entries', keywords: 'timesheet' },
      { to: '/leave',         icon: CalendarCheck, label: 'Leave',      desc: 'Request and track your leave', keywords: 'pto vacation' },
      { to: '/my-team-time',  icon: CheckSquare,   label: 'Team Time',  desc: 'Approve time for your reports', roles: ['admin', 'manager'], keywords: 'approve timesheet' },
      { to: '/team-leave',    icon: CalendarCheck, label: 'Team Leave', desc: 'Approve and view team leave', roles: ['admin', 'manager'] },
      { to: '/project-plans', icon: ListChecks,    label: 'Project Plans', roles: ['manager', 'employee'], tabKey: 'project-plans' },
      { to: '/concierge',     icon: Headset,       label: 'Concierge Tickets', roles: ['employee'] },
    ],
  },
  {
    key: 'delivery', label: 'Delivery', tagline: 'Active projects, utilization, and hours', accent: 'indigo', icon: Briefcase,
    roles: ['admin'],
    items: [
      { to: '/projects',      icon: FolderKanban, label: 'Current Projects',     desc: 'Delivery projects in flight' },
      { to: '/project-plans', icon: ListChecks,   label: 'Project Plans',        desc: 'Plans, milestones and tasks per project' },
      { to: '/team',          icon: Users,        label: 'Project Team',         desc: 'Team allocations by project' },
      { to: '/actual-hours',  icon: Clock,        label: 'Actual Hours',         desc: 'Recorded billable hours by person + project' },
      { to: '/pipeline',      icon: Layers,       label: 'Pipeline Projects',    desc: 'Pre-sales / pipeline projects in flight' },
      { to: '/forecasting',   icon: TrendingUp,   label: 'Utilization Forecast', desc: 'Bench + billable forecast across the roster' },
      { to: '/financials',    icon: DollarSign,   label: 'Financials',           desc: 'Revenue, margin, and P&L rollups', financial: true, keywords: 'p&l revenue margin' },
    ],
  },
  {
    key: 'talent', label: 'Talent Acquisition', tagline: 'Recruiting, candidates, and hiring plan', accent: 'violet', icon: Contact,
    roles: ['admin', 'manager'],
    items: [
      { to: '/ta-daily-log',          icon: CalendarCheck,  label: 'TA Daily Log',    desc: 'Daily recruiting activity log across the TA team' },
      { to: '/ta-metrics',            icon: BarChart3,      label: 'TA Metrics',      desc: 'Team-level TA KPIs and trends' },
      { to: '/candidates',            icon: Contact,        label: 'Candidates',      desc: 'Candidate database with Ask Claude search' },
      { to: '/screenings',            icon: ClipboardCheck, label: 'Screenings',      desc: 'Candidate screening calls and outcomes' },
      { to: '/hiring-radar',          icon: Radar,          label: 'Hiring Radar',    desc: 'Companies and roles worth watching' },
      { to: '/profile-format',        icon: FileEdit,       label: 'Profile Format',  desc: 'Resume reformatter + parser', keywords: 'resume cv' },
      { to: '/india-hiring-forecast', icon: UserPlus,       label: 'Hiring Forecast', desc: 'India hiring plan vs demand' },
      { to: '/vendors',               icon: Handshake,      label: 'Vendors',         desc: 'Staffing + recruiting partners' },
    ],
  },
  {
    key: 'india', label: 'India T&M', tagline: 'India staffing operations', accent: 'amber', icon: ClipboardList,
    roles: ['admin', 'manager'],
    items: [
      { to: '/india-staffing',         icon: ClipboardList, label: 'India Demand',     desc: 'Open positions + demand pipeline (India)' },
      { to: '/india-demand-analytics', icon: PieChart,      label: 'Demand Analytics', desc: 'Funnel and trend analytics on India demand' },
      { to: '/india-roster',           icon: Users,         label: 'India Roster',     desc: 'Every India billable + bench resource' },
    ],
  },
  {
    key: 'global', label: 'Global T&M', tagline: 'Global staffing operations', accent: 'teal', icon: Globe,
    roles: ['admin', 'manager'],
    items: [
      { to: '/us-staffing',  icon: Globe,     label: 'Global Demand', desc: 'Open positions + demand pipeline', keywords: 'us' },
      { to: '/us-roster',    icon: Users,     label: 'Global Roster', desc: 'Every billable + bench resource', keywords: 'us' },
      { to: '/tnm-accounts', icon: Building2, label: 'TNM Accounts',  desc: 'T&M client accounts and contacts' },
    ],
  },
  {
    key: 'sales', label: 'Sales & Accounts', tagline: 'Accounts, partnerships, and go-to-market', accent: 'emerald', icon: Target,
    roles: ['admin', 'manager'],
    items: [
      { to: '/accounts', icon: Building2, label: 'Accounts', desc: 'Client accounts, connects, forecast vs secured' },
      { to: '/gtm-list', icon: Target,    label: 'GTM List', desc: 'Strategic partnership targets and action items' },
      { to: '/dialer',   icon: PhoneCall, label: 'Dialer',   desc: 'Outbound calling' },
    ],
  },
  {
    key: 'concierge', label: 'Concierge', tagline: 'Managed-services accounts + AI account planning', accent: 'rose', icon: Headset,
    roles: ['admin', 'manager'],
    items: [
      { to: '/concierge', icon: Headset, label: 'Concierge', desc: 'Accounts, tickets, feature coverage, AI profile + opportunities' },
    ],
  },
  {
    key: 'admin', label: 'Admin', tagline: 'Users, access and audit trail', accent: 'slate', icon: ShieldCheck,
    roles: ['admin'],
    items: [
      { to: '/admin/users',    icon: UserCog,        label: 'Users',          desc: 'Authorized users, roles, permissions' },
      { to: '/admin/access',   icon: ShieldCheck,    label: 'Access Matrix',  desc: 'Who can see which page' },
      { to: '/admin/checkins', icon: ClipboardCheck, label: 'Check-in Admin' },
      { to: '/admin/leave',    icon: CalendarCheck,  label: 'Leave Admin' },
      { to: '/admin/activity', icon: Activity,       label: 'Activity',       desc: 'Team activity feed' },
      { to: '/admin/audit',    icon: History,        label: 'Audit Log',      desc: 'Change log across the app' },
    ],
  },
  {
    key: 'apps', label: 'Other Apps', tagline: 'Separate Simpliigence tools', accent: 'slate', icon: AppWindow,
    roles: ['admin', 'manager', 'employee'],
    items: [
      { href: 'https://simpliigence-hr-portal.vercel.app/dossier', icon: UserCog, label: 'HR Portal' },
    ],
  },
];

/** Tailwind classes per accent. Literal strings so Tailwind's scanner keeps them. */
export const NAV_ACCENT: Record<NavAccent, { dot: string; bar: string; icon: string; chip: string; hover: string }> = {
  blue:    { dot: 'bg-blue-400',    bar: 'bg-blue-400',    icon: 'text-blue-300',    chip: 'bg-blue-500/10 text-blue-500',       hover: 'group-hover:text-blue-500' },
  sky:     { dot: 'bg-sky-400',     bar: 'bg-sky-400',     icon: 'text-sky-300',     chip: 'bg-sky-500/10 text-sky-500',         hover: 'group-hover:text-sky-500' },
  indigo:  { dot: 'bg-indigo-400',  bar: 'bg-indigo-400',  icon: 'text-indigo-300',  chip: 'bg-indigo-500/10 text-indigo-500',   hover: 'group-hover:text-indigo-500' },
  violet:  { dot: 'bg-violet-400',  bar: 'bg-violet-400',  icon: 'text-violet-300',  chip: 'bg-violet-500/10 text-violet-500',   hover: 'group-hover:text-violet-500' },
  amber:   { dot: 'bg-amber-400',   bar: 'bg-amber-400',   icon: 'text-amber-300',   chip: 'bg-amber-500/12 text-amber-600',     hover: 'group-hover:text-amber-600' },
  teal:    { dot: 'bg-teal-400',    bar: 'bg-teal-400',    icon: 'text-teal-300',    chip: 'bg-teal-500/10 text-teal-600',       hover: 'group-hover:text-teal-600' },
  emerald: { dot: 'bg-emerald-400', bar: 'bg-emerald-400', icon: 'text-emerald-300', chip: 'bg-emerald-500/10 text-emerald-600', hover: 'group-hover:text-emerald-600' },
  rose:    { dot: 'bg-rose-400',    bar: 'bg-rose-400',    icon: 'text-rose-300',    chip: 'bg-rose-500/10 text-rose-500',       hover: 'group-hover:text-rose-500' },
  slate:   { dot: 'bg-slate-400',   bar: 'bg-slate-300',   icon: 'text-slate-200',   chip: 'bg-slate-500/10 text-slate-500',     hover: 'group-hover:text-slate-600' },
};

/** Does `path` belong to nav item `to`? ('/' only matches itself.) */
export function navMatches(path: string, to: string | undefined): boolean {
  if (!to) return false;
  if (to === '/') return path === '/';
  return path === to || path.startsWith(to + '/');
}
