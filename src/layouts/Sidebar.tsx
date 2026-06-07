import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  Layers,
  DollarSign,
  UserPlus,
  Settings,
  Headset,
  Zap,
  PanelLeftClose,
  ClipboardList,
  PanelLeftOpen,
  Globe,
  UserCheck,
  TrendingUp,
  Clock,
  Timer,
  CheckSquare,
  CalendarCheck,
  Contact,
  BarChart3,
  Building2,
  ChevronDown,
  ChevronRight,
  FileEdit,
  UserCog,
  Activity,
  History,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import { useAuthStore } from '../store/useAuthStore';

interface NavItem { to: string; icon: LucideIcon; label: string; }
interface NavSection { label: string; items: NavItem[]; }

const sections: NavSection[] = [
  {
    label: 'Home',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Projects',
    items: [
      { to: '/team', icon: Users, label: 'Project Team' },
      { to: '/actual-hours', icon: Clock, label: 'Actual Hours' },
      { to: '/projects', icon: FolderKanban, label: 'Current Projects' },
      { to: '/pipeline', icon: Layers, label: 'Pipeline Projects' },
      { to: '/forecasting', icon: TrendingUp, label: 'Utilization Forecast' },
      { to: '/hiring-forecast', icon: UserPlus, label: 'Hiring Forecast' },
      { to: '/financials', icon: DollarSign, label: 'Financials' },
    ],
  },
  {
    label: 'India T&M',
    items: [
      { to: '/india-staffing', icon: ClipboardList, label: 'India Demand' },
      { to: '/india-roster', icon: Users, label: 'Roster' },
      { to: '/india-hiring-forecast', icon: UserPlus, label: 'Hiring Forecast' },
      { to: '/ta-daily-log', icon: CalendarCheck, label: 'TA Daily Log' },
      { to: '/ta-metrics', icon: BarChart3, label: 'TA Metrics' },
      { to: '/candidates', icon: Contact, label: 'Candidates' },
      { to: '/profile-format', icon: FileEdit, label: 'Profile Format' },
    ],
  },
  {
    label: 'US T&M',
    items: [
      { to: '/us-staffing', icon: Globe, label: 'US Demand' },
      { to: '/us-roster', icon: Users, label: 'US Roster' },
      { to: '/open-bench', icon: UserCheck, label: 'Open Bench' },
    ],
  },
  {
    label: 'Account Management',
    items: [
      { to: '/accounts', icon: Building2, label: 'Accounts' },
    ],
  },
  {
    label: 'Other',
    items: [
      { to: '/concierge', icon: Headset, label: 'Concierge' },
    ],
  },
];

const adminSection: NavSection = {
  label: 'Admin',
  items: [
    { to: '/admin/users',    icon: UserCog,  label: 'Users' },
    { to: '/admin/activity', icon: Activity, label: 'Activity' },
    { to: '/admin/audit',    icon: History,  label: 'Audit Log' },
  ],
};

/** Nav shown to role='employee' users — they only see "My Time". */
const employeeOnlySections: NavSection[] = [
  {
    label: 'My Work',
    items: [
      { to: '/my-time', icon: Timer, label: 'My Time' },
    ],
  },
];

/** "My Time" link surfaced to admins/managers too, under the Projects group. */
const myTimeItem: NavItem = { to: '/my-time', icon: Timer, label: 'My Time' };
/** Manager approval queue, shown to admins/managers under the Projects group. */
const teamTimeItem: NavItem = { to: '/my-team-time', icon: CheckSquare, label: 'Team Time' };

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Mobile-only: whether the drawer is open. Ignored at md+ where the sidebar is permanently visible. */
  mobileOpen?: boolean;
  /** Mobile-only: dismiss the drawer. */
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen = false, onMobileClose }: SidebarProps) {
  const [email, setEmail] = useState<string | null>(null);
  const role = useAuthStore((s) => s.currentUser?.role);
  const isAdmin = role === 'admin';
  const isEmployee = role === 'employee';
  /**
   * "Effectively collapsed" — only applies on desktop. When the mobile drawer
   * is open the sidebar always renders the full labeled view (icons-only is
   * a desktop space-saver and unhelpful in a touch drawer).
   */
  const eff = collapsed && !mobileOpen;

  // Build role-appropriate nav:
  //   - employee: only "My Work · My Time"
  //   - TA Manager (role='manager'): everything EXCEPT the "Projects" section
  //     (no delivery/financials visibility). My Time + Team Time go into their
  //     own "My Work" group at the top.
  //   - admin: full nav + Admin section, with "My Time" + "Team Time" injected
  //     under Projects.
  const visibleSections = isEmployee
    ? employeeOnlySections
    : isAdmin
      ? sections
          .map((s) =>
            s.label === 'Projects'
              ? { ...s, items: [myTimeItem, teamTimeItem, ...s.items] }
              : s,
          )
          .concat([adminSection])
      : // TA Manager
        [
          { label: 'My Work', items: [myTimeItem, teamTimeItem] } as NavSection,
          ...sections.filter((s) => s.label !== 'Projects'),
        ];

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setEmail(data.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (mounted) setEmail(session?.user?.email ?? null);
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  // ── Collapsible section state ──
  const SECTION_STATE_KEY = 'sidebar-sections-expanded';
  const location = useLocation();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(SECTION_STATE_KEY);
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return {};
  });
  const activeSectionLabel = useMemo(() => {
    const path = location.pathname;
    for (const section of visibleSections) {
      if (section.items.some((i) =>
        path === i.to
        || (i.to !== '/' && path.startsWith(i.to + '/'))
        || (i.to === '/' && path === '/'))) {
        return section.label;
      }
    }
    return null;
  }, [location.pathname, visibleSections]);
  useEffect(() => {
    if (Object.keys(expandedSections).length === 0 && activeSectionLabel) {
      setExpandedSections({ [activeSectionLabel]: true });
    }
  }, [activeSectionLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(expandedSections)); } catch { /* ignore */ }
  }, [expandedSections]);
  const isSectionExpanded = (label: string) =>
    label === activeSectionLabel || expandedSections[label] === true;
  const toggleSection = (label: string) =>
    setExpandedSections((s) => ({ ...s, [label]: !isSectionExpanded(label) }));

  return (
    <aside
      className={`
        bg-sidebar h-screen flex flex-col fixed left-0 top-0 z-40
        transition-all duration-300 ease-in-out
        ${collapsed ? 'md:w-[68px]' : 'md:w-60'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
        w-64
      `}
    >
      {/* Mobile close button — only visible <md when drawer is open */}
      {onMobileClose && (
        <button
          type="button"
          onClick={onMobileClose}
          className="md:hidden absolute top-3 right-3 z-10 inline-flex items-center justify-center w-8 h-8 rounded text-slate-400 hover:text-white hover:bg-sidebar-hover"
          aria-label="Close menu"
        >
          ×
        </button>
      )}
      {/* Logo */}
      <div className={`flex items-center ${eff ? 'justify-center px-2' : 'px-5'} py-5 gap-2.5`}>
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
          <Zap size={18} className="text-white" />
        </div>
        {!eff && (
          <span className="text-white font-bold text-lg tracking-tight whitespace-nowrap overflow-hidden">
            Simpliigence
          </span>
        )}
      </div>

      {/* Nav — grouped by section */}
      <nav className={`flex-1 ${eff ? 'px-2' : 'px-3'} pb-2 space-y-2 overflow-y-auto overflow-x-hidden`}>
        {visibleSections.map((section, idx) => {
          // Desktop icon-only mode: show all items, no toggles.
          if (eff) {
            return (
              <div key={section.label}>
                {idx > 0 && <div className="mx-2 my-2 border-t border-slate-700/40" />}
                <div className="space-y-0.5">
                  {section.items.map(({ to, icon: Icon, label }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      title={`${section.label} — ${label}`}
                      className={({ isActive }) =>
                        `flex items-center justify-center gap-3 px-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-sidebar-active text-white'
                            : 'text-slate-400 hover:text-white hover:bg-sidebar-hover'
                        }`
                      }
                    >
                      <Icon size={17} className="flex-shrink-0" />
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          }
          // Expanded sidebar: section header toggles. Active section is forced open.
          const expanded = isSectionExpanded(section.label);
          const isActiveSection = section.label === activeSectionLabel;
          return (
            <div key={section.label}>
              <button
                type="button"
                onClick={() => toggleSection(section.label)}
                aria-expanded={expanded}
                className={`w-full flex items-center justify-between gap-2 px-3 pb-1 pt-1 rounded-md text-[9px] font-bold uppercase tracking-widest hover:bg-sidebar-hover transition-colors ${
                  isActiveSection ? 'text-slate-300' : 'text-slate-500 hover:text-slate-300'
                }`}
                title={expanded ? 'Collapse section' : 'Expand section'}
              >
                <span className="truncate">{section.label}</span>
                <span className="flex items-center gap-1.5">
                  {!expanded && (
                    <span className="text-[9px] font-normal tracking-normal text-slate-500 normal-case">
                      {section.items.length}
                    </span>
                  )}
                  {expanded
                    ? <ChevronDown size={11} className="flex-shrink-0" />
                    : <ChevronRight size={11} className="flex-shrink-0" />}
                </span>
              </button>
              {expanded && (
                <div className="space-y-0.5 mt-0.5">
                  {section.items.map(({ to, icon: Icon, label }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-sidebar-active text-white'
                            : 'text-slate-400 hover:text-white hover:bg-sidebar-hover'
                        }`
                      }
                    >
                      <Icon size={17} className="flex-shrink-0" />
                      <span className="whitespace-nowrap overflow-hidden">{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!eff && visibleSections.length > 1 && (
          <div className="px-3 pt-2">
            <button
              type="button"
              onClick={() => {
                const allExpanded = visibleSections.every((s) => isSectionExpanded(s.label));
                const next: Record<string, boolean> = {};
                for (const s of visibleSections) next[s.label] = !allExpanded;
                setExpandedSections(next);
              }}
              className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              {visibleSections.every((s) => isSectionExpanded(s.label)) ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
        )}
      </nav>

      {/* User identity + sign-out */}
      {email && (
        <div className={`${eff ? 'px-2' : 'px-3'} pt-3 border-t border-slate-700/40`}>
          {eff ? (
            <button
              type="button"
              onClick={() => signOut()}
              title={`Signed in as ${email} — click to sign out`}
              className="flex items-center justify-center w-full py-2 rounded-lg text-slate-400 hover:text-white hover:bg-sidebar-hover transition-colors"
            >
              <span className="w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center uppercase">
                {email.charAt(0)}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="w-7 h-7 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center uppercase flex-shrink-0">
                {email.charAt(0)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-slate-300 truncate" title={email}>{email}</div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className="text-[10px] text-slate-500 hover:text-white inline-flex items-center gap-1 mt-0.5 transition-colors"
                >
                  <LogOut size={10} /> Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom: Settings + Toggle */}
      <div className={`${eff ? 'px-2' : 'px-3'} pb-3 pt-2 space-y-1`}>
        <NavLink
          to="/settings"
          title={eff ? 'Settings' : undefined}
          className={({ isActive }) =>
            `flex items-center ${eff ? 'justify-center' : ''} gap-3 ${eff ? 'px-2' : 'px-3'} py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-sidebar-active text-white'
                : 'text-slate-400 hover:text-white hover:bg-sidebar-hover'
            }`
          }
        >
          <Settings size={18} className="flex-shrink-0" />
          {!eff && <span>Settings</span>}
        </NavLink>

        {/* Desktop-only sidebar collapse toggle */}
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden md:flex items-center ${eff ? 'justify-center' : ''} gap-3 ${eff ? 'px-2' : 'px-3'} py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:text-white hover:bg-sidebar-hover transition-colors w-full`}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!eff && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
