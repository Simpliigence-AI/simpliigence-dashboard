/**
 * The nav groups the current viewer may see, after:
 *   1. role        — employee / manager (TA) / admin
 *   2. tab perms   — e.g. Project Plans for non-admin plan owners
 *   3. access matrix — items keyed to a page set to `none` are hidden
 *   4. financials  — Financials is removed entirely while "Financials hidden"
 *
 * Sidebar, ⌘K palette and Home all call this, so they always agree.
 */
import { useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useAccessStore } from '../store/useAccessStore';
import { useIsOwner } from '../components/OwnerOnly';
import { useShowFinancials } from './usePageAccess';
import { useTabPermission } from './useTabPermission';
import { normalizePageKey } from '../lib/pageCatalog';
import { NAV_GROUPS, type NavGroup, type NavRole } from '../lib/navConfig';

export function useNavSections(): NavGroup[] {
  const role = useAuthStore((s) => s.currentUser?.role);
  const isAdmin = useAuthStore((s) => !!s.currentUser?.isAdmin);
  const currentEmail = useAuthStore((s) => s.currentUser?.email);
  const accessEntries = useAccessStore((s) => s.entries);
  const isOwner = useIsOwner();
  const showFinancials = useShowFinancials();
  const plansPerm = useTabPermission('project-plans');

  const navRole: NavRole = isAdmin ? 'admin' : role === 'employee' ? 'employee' : 'manager';
  const tabAllowed: Record<string, boolean> = { 'project-plans': plansPerm.canView };

  return useMemo(() => {
    const email = (currentEmail ?? '').toLowerCase();
    const blockedByMatrix = (to: string | undefined) => {
      if (isOwner || !to) return false;
      const key = normalizePageKey(to);
      const row = accessEntries.find((e) => e.userEmail === email && e.pageKey === key);
      return row?.level === 'none';
    };
    return NAV_GROUPS
      .filter((g) => g.roles.includes(navRole))
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          if (item.roles && !item.roles.includes(navRole)) return false;
          if (item.tabKey && navRole !== 'admin' && !tabAllowed[item.tabKey]) return false;
          if (item.financial && !showFinancials) return false;
          if (item.href) return true;
          return !blockedByMatrix(item.to);
        }),
      }))
      .filter((g) => g.items.length > 0);
    // tabAllowed is derived from plansPerm.canView
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRole, plansPerm.canView, showFinancials, isOwner, currentEmail, accessEntries]);
}
