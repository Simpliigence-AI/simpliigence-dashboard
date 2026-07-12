/**
 * Actionable upsell / cross-sell backlog per Concierge account.
 *
 * Two ways items land here:
 *   1. Manually via the Opportunities tab in the account drawer.
 *   2. Promoted from the AI Profile / Feature Coverage callout — the
 *      Claude-suggested opportunities are captured with source='ai_profile'.
 *
 * Rows carry an assignee + due date so they double as action-tracking, and
 * a status so managers can move them through open → in_progress → won/lost.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
  UpsellBacklogItem,
  UpsellKind,
  UpsellSource,
  UpsellStatus,
} from '../types/concierge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToItem(r: any): UpsellBacklogItem {
  return {
    id: r.id,
    accountId: r.account_id,
    title: r.title,
    kind: r.kind,
    source: r.source,
    sourceRef: r.source_ref ?? null,
    cloud: r.cloud ?? null,
    rationale: r.rationale ?? null,
    estimatedValueUsd: r.estimated_value_usd == null ? null : Number(r.estimated_value_usd),
    assigneeEmail: r.assignee_email ?? null,
    dueDate: r.due_date ?? null,
    status: r.status,
    notes: r.notes ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface State {
  itemsByAccount: Record<string, UpsellBacklogItem[]>;
  loadingByAccount: Record<string, boolean>;

  loadForAccount: (accountId: string) => Promise<void>;
  add: (params: {
    accountId: string;
    title: string;
    kind: UpsellKind;
    source?: UpsellSource;
    sourceRef?: string | null;
    cloud?: string | null;
    rationale?: string | null;
    estimatedValueUsd?: number | null;
    assigneeEmail?: string | null;
    dueDate?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }) => Promise<UpsellBacklogItem>;
  update: (id: string, patch: Partial<UpsellBacklogItem>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** True iff there is any backlog item for this account whose sourceRef
   *  matches the given AI-opp title (case-insensitive). Used to hide the
   *  "Promote" button once an opp has already been added. */
  hasPromoted: (accountId: string, title: string) => boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbPatch(patch: Partial<UpsellBacklogItem>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.kind !== undefined) out.kind = patch.kind;
  if (patch.status !== undefined) out.status = patch.status;
  if (patch.assigneeEmail !== undefined) out.assignee_email = patch.assigneeEmail;
  if (patch.dueDate !== undefined) out.due_date = patch.dueDate;
  if (patch.cloud !== undefined) out.cloud = patch.cloud;
  if (patch.rationale !== undefined) out.rationale = patch.rationale;
  if (patch.estimatedValueUsd !== undefined) out.estimated_value_usd = patch.estimatedValueUsd;
  if (patch.notes !== undefined) out.notes = patch.notes;
  out.updated_at = new Date().toISOString();
  return out;
}

export const useUpsellBacklogStore = create<State>((set, get) => ({
  itemsByAccount: {},
  loadingByAccount: {},

  loadForAccount: async (accountId) => {
    set((s) => ({ loadingByAccount: { ...s.loadingByAccount, [accountId]: true } }));
    try {
      const { data, error } = await supabase
        .from('concierge_upsell_backlog')
        .select('*')
        .eq('account_id', accountId)
        .order('status')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      set((s) => ({ itemsByAccount: { ...s.itemsByAccount, [accountId]: (data ?? []).map(rowToItem) } }));
    } catch (e) {
      console.warn('[upsell-backlog] load failed:', (e as Error).message);
    } finally {
      set((s) => ({ loadingByAccount: { ...s.loadingByAccount, [accountId]: false } }));
    }
  },

  add: async ({ accountId, title, kind, source = 'manual', sourceRef = null, cloud = null, rationale = null, estimatedValueUsd = null, assigneeEmail = null, dueDate = null, notes = null, createdBy = null }) => {
    const insert = {
      account_id: accountId,
      title: title.trim(),
      kind,
      source,
      source_ref: sourceRef,
      cloud,
      rationale,
      estimated_value_usd: estimatedValueUsd,
      assignee_email: assigneeEmail?.toLowerCase() ?? null,
      due_date: dueDate,
      status: 'open',
      notes,
      created_by: createdBy?.toLowerCase() ?? null,
    };
    const { data, error } = await supabase.from('concierge_upsell_backlog').insert(insert).select().single();
    if (error || !data) throw new Error(`Insert failed: ${error?.message}`);
    const item = rowToItem(data);
    set((s) => ({
      itemsByAccount: {
        ...s.itemsByAccount,
        [accountId]: [item, ...(s.itemsByAccount[accountId] ?? [])],
      },
    }));
    return item;
  },

  update: async (id, patch) => {
    const dbPatch = toDbPatch(patch);
    const { data, error } = await supabase.from('concierge_upsell_backlog').update(dbPatch).eq('id', id).select().single();
    if (error || !data) throw new Error(`Update failed: ${error?.message}`);
    const item = rowToItem(data);
    set((s) => {
      const next: Record<string, UpsellBacklogItem[]> = { ...s.itemsByAccount };
      const arr = next[item.accountId] ?? [];
      next[item.accountId] = arr.map((x) => (x.id === item.id ? item : x));
      return { itemsByAccount: next };
    });
  },

  remove: async (id) => {
    const { error } = await supabase.from('concierge_upsell_backlog').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((s) => {
      const next: Record<string, UpsellBacklogItem[]> = {};
      for (const [acc, arr] of Object.entries(s.itemsByAccount)) next[acc] = arr.filter((x) => x.id !== id);
      return { itemsByAccount: next };
    });
  },

  hasPromoted: (accountId, title) => {
    const arr = get().itemsByAccount[accountId] ?? [];
    const t = title.trim().toLowerCase();
    return arr.some((x) => (x.title || '').toLowerCase() === t || (x.sourceRef || '').toLowerCase() === t);
  },
}));

export type { UpsellStatus };
