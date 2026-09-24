/**
 * App sidebar.
 *
 * Groups come from `lib/navConfig.ts` via `useNavSections()` (role, tab
 * permission, access matrix and financials filtering all live there).
 *
 * Behaviour:
 *   - Accordion: one group open at a time. The group holding the current
 *     page opens automatically; clicking another header opens that one.
 *   - Each group has its own accent colour (dot, active bar, active icon),
 *     matching the Home page cards.
 *   - ⌘K / Ctrl+K (or the Search button) opens the page finder.
 *   - Collapsed rail: icons only, grouped by thin dividers, with tooltips.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Settings, Zap, PanelLeftClose, PanelLeftOpen, ChevronDown, LogOut, ExternalLink,
  Sun, Moon, SunMoon, Eye, EyeOff, Search,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import { useThemeStore, type ThemePreference } from '../store/useThemeStore';
import { useFinancialsRevealStore } from '../store/useFinancialsRevealStore';
import { useCanRevealFinancials } from '../hooks/usePageAccess';
import { useNavSections } from '../hooks/useNavSections';
import { NAV_ACCENT, navMatches, type NavGroup, type NavItem } from '../lib/navConfig';
import { CommandPalette } from '../components/CommandPalette';

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
  /** "Effectively collapsed" — icon rail on desktop only; the mobile drawer is always full. */
  const eff = collapsed && !mobileOpen;

  const groups = useNavSections();

  const revealed = useFinancialsRevealStore((s) => s.revealed);
  const toggleReveal = useFinancialsRevealStore((s) => s.toggle);
  const canReveal = useCanRevealFinancials();

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

  // ── Which group is open ──
  // The group containing the current page wins. A header click overrides it
  // until the next navigation (stored with the path it was made on, so no
  // effect is needed to "reset" it).
  const location = useLocation();
  const activeGroupKey = useMemo(() => {
    const hit = groups.find((g) => g.items.some((i) => navMatches(location.pathname, i.to)));
    return hit?.key ?? null;
  }, [groups, location.pathname]);
  const [manual, setManual] = useState<{ path: string; key: string | null } | null>(null);
  const openKey = manual && manual.path === location.pathname ? manual.key : activeGroupKey;
  const toggleGroup = (key: string) =>
    setManual({ path: location.pathname, key: openKey === key ? null : key });

  // ── ⌘K palette ──
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <aside
      className={`
        bg-sidebar border-r border-sidebar-line h-screen flex flex-col fixed left-0 top-0 z-40
        transition-all duration-300 ease-in-out
        ${collapsed ? 'md:w-[76px]' : 'md:w-72'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
        w-72
      `}
    >
      {onMobileClose && (
        <button
          type="button"
          onClick={onMobileClose}
          className="md:hidden absolute top-3 right-3 z-10 inline-flex items-center justify-center w-8 h-8 rounded text-sidebar-dim hover:text-white hover:bg-sidebar-hover"
          aria-label="Close menu"
        >
          ×
        </button>
      )}

      {/* Brand */}
      <div className={`flex items-center ${eff ? 'justify-center px-2' : 'px-5'} pt-5 pb-4 gap-2.5`}>
        <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center flex-shrink-0 shadow-[0_6px_18px_rgba(59,130,246,0.35)]">
          <Zap size={18} className="text-white" />
        </div>
        {!eff && (
          <div className="min-w-0 leading-tight">
            <div className="text-white font-bold text-[1.0625rem] tracking-tight truncate">Simpliigence</div>
            <div className="text-[11px] text-sidebar-dim truncate">Delivery Cockpit</div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className={`${eff ? 'px-2' : 'px-3'} pb-3`}>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title={`Search pages (${isMac ? '⌘' : 'Ctrl+'}K)`}
          className={`w-full flex items-center ${eff ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-2'} rounded-lg bg-white/[0.05] border border-sidebar-line text-sidebar-dim hover:text-white hover:bg-white/[0.08] transition-colors text-sm`}
        >
          <Search size={16} className="flex-shrink-0" />
          {!eff && (
            <>
              <span className="flex-1 text-left">Search pages…</span>
              <kbd className="text-[10px] font-semibold border border-sidebar-line rounded px-1.5 py-0.5">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
            </>
          )}
        </button>
      </div>

      {/* Groups */}
      <nav className={`flex-1 ${eff ? 'px-2' : 'px-3'} pb-2 overflow-y-auto overflow-x-hidden`} aria-label="Main">
        {groups.map((group, idx) =>
          eff ? (
            <RailGroup key={group.key} group={group} first={idx === 0} />
          ) : (
            <AccordionGroup
              key={group.key}
              group={group}
              open={openKey === group.key}
              containsActive={activeGroupKey === group.key}
              onToggle={() => toggleGroup(group.key)}
            />
          ),
        )}
      </nav>

      {/* Footer */}
      <div className={`${eff ? 'px-2' : 'px-3'} pt-2 pb-3 border-t border-sidebar-line space-y-1`}>
        {/* Financials reveal toggle — hides the Financials page and masks values when off. */}
        <button
          type="button"
          onClick={() => { if (canReveal) toggleReveal(); }}
          title={
            !canReveal
              ? 'Financials are hidden. You do not have permission to reveal them.'
              : revealed
                ? 'Financials are visible for this session — click to hide'
                : 'Financials are hidden — click to show for this session'
          }
          className={`w-full flex items-center ${eff ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-lg text-sm font-medium transition-colors ${
            revealed && canReveal
              ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
              : canReveal
                ? 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
                : 'text-sidebar-dim/60 cursor-not-allowed'
          }`}
        >
          {revealed && canReveal ? <Eye size={17} className="flex-shrink-0" /> : <EyeOff size={17} className="flex-shrink-0" />}
          {!eff && <span className="flex-1 text-left">{revealed && canReveal ? 'Financials shown' : 'Financials hidden'}</span>}
        </button>

        {/* User */}
        {email && (
          <div className={`flex items-center ${eff ? 'justify-center' : 'gap-2.5 px-2'} py-1.5`}>
            <span
              className="w-8 h-8 rounded-full bg-primary/25 text-blue-200 text-xs font-bold flex items-center justify-center uppercase flex-shrink-0"
              title={email}
            >
              {email.charAt(0)}
            </span>
            {!eff && (
              <>
                <div className="flex-1 min-w-0 text-[12px] text-sidebar-text truncate" title={email}>{email}</div>
                <IconButton title="Sign out" onClick={() => signOut()}><LogOut size={15} /></IconButton>
              </>
            )}
          </div>
        )}

        {/* Utility row: theme · settings · collapse */}
        <div className={`flex ${eff ? 'flex-col items-center gap-1' : 'items-center gap-1 px-1'}`}>
          <ThemeToggle />
          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `inline-flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
                isActive ? 'bg-white/10 text-white' : 'text-sidebar-dim hover:text-white hover:bg-sidebar-hover'
              }`
            }
          >
            <Settings size={17} />
          </NavLink>
          {eff && email && (
            <IconButton title={`Sign out (${email})`} onClick={() => signOut()}><LogOut size={16} /></IconButton>
          )}
          <span className={`hidden md:inline-flex ${eff ? '' : 'md:ml-auto'}`}>
            <IconButton title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>
              {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </IconButton>
          </span>
        </div>
      </div>

      {/* Portalled to <body>: the aside's translate makes it the containing
          block for fixed children, which would trap the palette inside it. */}
      {paletteOpen && createPortal(<CommandPalette groups={groups} onClose={() => setPaletteOpen(false)} />, document.body)}
    </aside>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function AccordionGroup({
  group, open, containsActive, onToggle,
}: { group: NavGroup; open: boolean; containsActive: boolean; onToggle: () => void }) {
  const a = NAV_ACCENT[group.accent];
  return (
    <div className="mb-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-sidebar-hover ${
          open || containsActive ? 'text-white' : 'text-sidebar-dim hover:text-sidebar-text'
        }`}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.dot} ${open || containsActive ? '' : 'opacity-70'}`} />
        <span className="flex-1 text-left truncate">{group.label}</span>
        {!open && (
          <span className="text-[10px] font-medium tracking-normal normal-case text-sidebar-dim tabular-nums">
            {group.items.length}
          </span>
        )}
        <ChevronDown size={13} className={`flex-shrink-0 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="mt-0.5 mb-2 space-y-0.5">
          {group.items.map((item) => (
            <ItemLink key={item.to ?? item.href} item={item} accent={group.accent} />
          ))}
        </div>
      )}
    </div>
  );
}

function RailGroup({ group, first }: { group: NavGroup; first: boolean }) {
  return (
    <div>
      {!first && <div className="mx-3 my-2 border-t border-sidebar-line" />}
      <div className="space-y-0.5">
        {group.items.map((item) => (
          <ItemLink key={item.to ?? item.href} item={item} accent={group.accent} iconOnly title={`${group.label} — ${item.label}`} />
        ))}
      </div>
    </div>
  );
}

function ItemLink({
  item, accent, iconOnly, title,
}: { item: NavItem; accent: NavGroup['accent']; iconOnly?: boolean; title?: string }) {
  const a = NAV_ACCENT[accent];
  const Icon = item.icon;
  const base = `group relative flex items-center ${iconOnly ? 'justify-center px-2' : 'gap-3 pl-4 pr-3'} py-2 rounded-lg text-[0.875rem] transition-colors`;

  if (item.href) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        title={title ?? item.label}
        className={`${base} text-sidebar-text hover:text-white hover:bg-sidebar-hover font-medium`}
      >
        <Icon size={17} className="flex-shrink-0 text-sidebar-dim group-hover:text-white" />
        {!iconOnly && <span className="flex-1 truncate">{item.label}</span>}
        {!iconOnly && <ExternalLink size={11} className="flex-shrink-0 opacity-50" />}
      </a>
    );
  }
  const to = item.to || '/';
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={iconOnly ? title : undefined}
      className={({ isActive }) =>
        `${base} ${
          isActive
            ? 'bg-white/[0.08] text-white font-semibold'
            : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover font-medium'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full ${a.bar}`} />}
          <Icon size={17} className={`flex-shrink-0 ${isActive ? a.icon : 'text-sidebar-dim group-hover:text-white'}`} />
          {!iconOnly && <span className="truncate">{item.label}</span>}
        </>
      )}
    </NavLink>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-sidebar-dim hover:text-white hover:bg-sidebar-hover transition-colors"
    >
      {children}
    </button>
  );
}

/**
 * Theme toggle. Three-state cycle: auto → light → dark → auto.
 * Icon shows the current preference; the tooltip says what auto resolves to.
 */
function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const mode = useThemeStore((s) => s.mode);
  const setPreference = useThemeStore((s) => s.setPreference);

  const cycle: ThemePreference[] = ['auto', 'light', 'dark'];
  const next = cycle[(cycle.indexOf(preference) + 1) % cycle.length];
  const Icon = preference === 'auto' ? SunMoon : preference === 'light' ? Sun : Moon;
  const label = preference === 'auto' ? `Theme: auto (${mode})` : preference === 'light' ? 'Theme: light' : 'Theme: dark';

  return (
    <IconButton title={`${label} — click for ${next}`} onClick={() => setPreference(next)}>
      <Icon size={17} />
    </IconButton>
  );
}
