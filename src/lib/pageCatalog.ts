/**
 * Canonical list of pages that participate in the access matrix.
 *
 * `key` matches the route path (without leading slash) so the same string
 * lives in the router, the sidebar, and the user_page_access rows. The
 * section grouping mirrors the sidebar so the admin matrix page can lay
 * things out the way a reader already recognises.
 *
 * Add a page here when you add a new route that needs to be gateable per
 * user. External links (href in the sidebar) aren't gated — they always
 * show.
 */

export interface PageDef {
  key: string;
  label: string;
  section: string;
}

export const PAGES: PageDef[] = [
  // Home
  { key: 'home', label: 'Delivery Cockpit', section: 'Home' },
  { key: '/',    label: 'Dashboard',        section: 'Home' },

  // Projects
  { key: 'team',            label: 'Project Team',        section: 'Projects' },
  { key: 'actual-hours',    label: 'Actual Hours',        section: 'Projects' },
  { key: 'projects',        label: 'Current Projects',    section: 'Projects' },
  { key: 'pipeline',        label: 'Pipeline Projects',   section: 'Projects' },
  { key: 'forecasting',     label: 'Utilization Forecast',section: 'Projects' },
  { key: 'hiring-forecast', label: 'Hiring Forecast',     section: 'Projects' },
  { key: 'financials',      label: 'Financials',          section: 'Projects' },

  // India T&M
  { key: 'india-staffing',         label: 'India Demand',    section: 'India T&M' },
  { key: 'india-roster',           label: 'Roster',          section: 'India T&M' },
  { key: 'india-hiring-forecast',  label: 'Hiring Forecast', section: 'India T&M' },
  { key: 'ta-daily-log',           label: 'TA Daily Log',    section: 'India T&M' },
  { key: 'ta-metrics',             label: 'TA Metrics',      section: 'India T&M' },
  { key: 'candidates',             label: 'Candidates',      section: 'India T&M' },
  { key: 'profile-format',         label: 'Profile Format',  section: 'India T&M' },
  { key: 'hiring-radar',           label: 'Hiring Radar',    section: 'India T&M' },

  // Global T&M
  { key: 'us-staffing',   label: 'Global Demand', section: 'Global T&M' },
  { key: 'us-roster',     label: 'Global Roster', section: 'Global T&M' },
  { key: 'tnm-accounts',  label: 'TNM Accounts',  section: 'Global T&M' },

  // Account Management
  { key: 'accounts', label: 'Accounts', section: 'Account Management' },
  { key: 'vendors',  label: 'Vendors',  section: 'Account Management' },
  { key: 'gtm-list', label: 'GTM List', section: 'Account Management' },
  { key: 'dialer',   label: 'Dialer',   section: 'Account Management' },

  // Other
  { key: 'concierge', label: 'Concierge', section: 'Other' },

  // Portals (always available in principle; kept here so the matrix can
  // still gate access even though these are also linked as top-level portals).
  { key: 'my-time',      label: 'My Time',    section: 'My Work' },
  { key: 'leave',        label: 'Leave',      section: 'My Work' },
  { key: 'my-team-time', label: 'Team Time',  section: 'My Work' },
  { key: 'team-leave',   label: 'Team Leave', section: 'My Work' },

  // Admin — the access matrix page itself is owner-only in code and is
  // therefore intentionally NOT listed. Everything else is gateable.
  { key: 'admin/users',    label: 'Users',      section: 'Admin' },
  { key: 'admin/leave',    label: 'Leave Admin',section: 'Admin' },
  { key: 'admin/activity', label: 'Activity',   section: 'Admin' },
  { key: 'admin/audit',    label: 'Audit Log',  section: 'Admin' },
];

export const PAGE_SECTIONS: string[] = Array.from(new Set(PAGES.map((p) => p.section)));

/**
 * The route key used in user_page_access rows. NavLink `to="/"` becomes
 * key '/', everything else strips the leading slash.
 */
export function normalizePageKey(to: string | undefined): string {
  if (!to) return '';
  if (to === '/') return '/';
  return to.replace(/^\/+/, '');
}
