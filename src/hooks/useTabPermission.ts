/**
 * useTabPermission(tabKey) — the same verdict RLS reaches, fetched once per
 * tab per session through the tab_permission() SQL function.
 *
 * The UI uses it to hide the nav item and the edit controls; RLS is still
 * what actually enforces it, so a stale answer here can only mean a button
 * that fails with a clear error, never data the user shouldn't see.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

export interface TabPermission {
  canView: boolean;
  canEdit: boolean;
  canApprove: boolean;
  loading: boolean;
}

const cache = new Map<string, Promise<Omit<TabPermission, 'loading'>>>();

function fetchPermission(email: string, tabKey: string) {
  const key = `${email}|${tabKey}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const { data, error } = await supabase.rpc('tab_permission', { p_tab_key: tabKey });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      return {
        canView: !!row?.can_view,
        canEdit: !!row?.can_edit,
        canApprove: !!row?.can_approve,
      };
    })().catch((e) => {
      cache.delete(key); // let the next mount retry
      throw e;
    });
    cache.set(key, p);
  }
  return p;
}

export function useTabPermission(tabKey: string): TabPermission {
  const email = useAuthStore((s) => s.currentUser?.email?.toLowerCase() ?? null);
  const [state, setState] = useState<TabPermission>({ canView: false, canEdit: false, canApprove: false, loading: true });

  useEffect(() => {
    let alive = true;
    if (!email) return;
    fetchPermission(email, tabKey)
      .then((p) => { if (alive) setState({ ...p, loading: false }); })
      .catch(() => { if (alive) setState({ canView: false, canEdit: false, canApprove: false, loading: false }); });
    return () => { alive = false; };
  }, [email, tabKey]);

  return email ? state : { canView: false, canEdit: false, canApprove: false, loading: true };
}
