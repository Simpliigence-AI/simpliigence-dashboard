/**
 * GTM List store — strategic accounts + contacts + actions.
 *
 * Not persisted to localStorage; always reads from Supabase so multiple
 * users editing the same account see each other's changes on refresh.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
  GtmAccount,
  GtmAction,
  GtmActionStatus,
  GtmContact,
  GtmPriority,
  GtmStatus,
} from '../types/gtm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAccount(r: any): GtmAccount {
  return {
    id: r.id,
    name: r.name,
    website: r.website ?? null,
    industry: r.industry ?? null,
    segment: r.segment ?? null,
    geo: r.geo ?? null,
    partnershipType: r.partnership_type ?? null,
    status: r.status,
    priority: r.priority,
    assigneeEmail: r.assignee_email ?? null,
    estimatedAnnualValueUsd: r.estimated_annual_value_usd == null ? null : Number(r.estimated_annual_value_usd),
    nextStep: r.next_step ?? null,
    nextStepDate: r.next_step_date ?? null,
    rationale: r.rationale ?? null,
    notes: r.notes ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToContact(r: any): GtmContact {
  return {
    id: r.id,
    gtmAccountId: r.gtm_account_id,
    name: r.name,
    title: r.title ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
    linkedinUrl: r.linkedin_url ?? null,
    relationshipOwner: r.relationship_owner ?? null,
    lastTouched: r.last_touched ?? null,
    notes: r.notes ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAction(r: any): GtmAction {
  return {
    id: r.id,
    gtmAccountId: r.gtm_account_id,
    title: r.title,
    description: r.description ?? null,
    assigneeEmail: r.assignee_email ?? null,
    dueDate: r.due_date ?? null,
    status: r.status,
    completedAt: r.completed_at ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDbAccountPatch(patch: Partial<GtmAccount>): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o: Record<string, any> = {};
  if (patch.name !== undefined) o.name = patch.name;
  if (patch.website !== undefined) o.website = patch.website;
  if (patch.industry !== undefined) o.industry = patch.industry;
  if (patch.segment !== undefined) o.segment = patch.segment;
  if (patch.geo !== undefined) o.geo = patch.geo;
  if (patch.partnershipType !== undefined) o.partnership_type = patch.partnershipType;
  if (patch.status !== undefined) o.status = patch.status;
  if (patch.priority !== undefined) o.priority = patch.priority;
  if (patch.assigneeEmail !== undefined) o.assignee_email = patch.assigneeEmail;
  if (patch.estimatedAnnualValueUsd !== undefined) o.estimated_annual_value_usd = patch.estimatedAnnualValueUsd;
  if (patch.nextStep !== undefined) o.next_step = patch.nextStep;
  if (patch.nextStepDate !== undefined) o.next_step_date = patch.nextStepDate;
  if (patch.rationale !== undefined) o.rationale = patch.rationale;
  if (patch.notes !== undefined) o.notes = patch.notes;
  o.updated_at = new Date().toISOString();
  return o;
}

interface State {
  accounts: GtmAccount[];
  contactsByAccount: Record<string, GtmContact[]>;
  actionsByAccount: Record<string, GtmAction[]>;
  loading: boolean;
  loadedAt: string | null;

  loadAll: () => Promise<void>;
  loadDetail: (accountId: string) => Promise<void>;

  addAccount: (params: { name: string; assigneeEmail?: string | null; priority?: GtmPriority; status?: GtmStatus; createdBy?: string | null }) => Promise<GtmAccount>;
  updateAccount: (id: string, patch: Partial<GtmAccount>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;

  addContact: (params: { gtmAccountId: string; name: string; title?: string | null; email?: string | null; phone?: string | null; linkedinUrl?: string | null; relationshipOwner?: string | null; lastTouched?: string | null; notes?: string | null }) => Promise<GtmContact>;
  updateContact: (id: string, patch: Partial<GtmContact>) => Promise<void>;
  removeContact: (id: string) => Promise<void>;

  addAction: (params: { gtmAccountId: string; title: string; description?: string | null; assigneeEmail?: string | null; dueDate?: string | null; createdBy?: string | null }) => Promise<GtmAction>;
  updateAction: (id: string, patch: Partial<GtmAction>) => Promise<void>;
  removeAction: (id: string) => Promise<void>;
}

export const useGtmStore = create<State>((set, get) => ({
  accounts: [],
  contactsByAccount: {},
  actionsByAccount: {},
  loading: false,
  loadedAt: null,

  loadAll: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('gtm_accounts')
        .select('*')
        .order('priority', { ascending: true })
        .order('next_step_date', { ascending: true, nullsFirst: false })
        .order('name');
      if (error) throw new Error(error.message);
      set({ accounts: (data ?? []).map(rowToAccount), loadedAt: new Date().toISOString() });
    } catch (e) {
      console.warn('[gtm] load failed:', (e as Error).message);
    } finally {
      set({ loading: false });
    }
  },

  loadDetail: async (accountId) => {
    const [c, a] = await Promise.all([
      supabase.from('gtm_contacts').select('*').eq('gtm_account_id', accountId).order('created_at'),
      supabase.from('gtm_actions').select('*').eq('gtm_account_id', accountId).order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }),
    ]);
    if (!c.error) set((s) => ({ contactsByAccount: { ...s.contactsByAccount, [accountId]: (c.data ?? []).map(rowToContact) } }));
    if (!a.error) set((s) => ({ actionsByAccount: { ...s.actionsByAccount, [accountId]: (a.data ?? []).map(rowToAction) } }));
  },

  addAccount: async ({ name, assigneeEmail = null, priority = 'medium', status = 'prospecting', createdBy = null }) => {
    const { data, error } = await supabase.from('gtm_accounts').insert({
      name: name.trim(),
      assignee_email: assigneeEmail?.toLowerCase() ?? null,
      priority,
      status,
      created_by: createdBy?.toLowerCase() ?? null,
    }).select().single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    const acct = rowToAccount(data);
    set((s) => ({ accounts: [acct, ...s.accounts] }));
    return acct;
  },

  updateAccount: async (id, patch) => {
    const { data, error } = await supabase.from('gtm_accounts').update(toDbAccountPatch(patch)).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'update failed');
    const acct = rowToAccount(data);
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === acct.id ? acct : a)) }));
  },

  removeAccount: async (id) => {
    const { error } = await supabase.from('gtm_accounts').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((s) => ({
      accounts: s.accounts.filter((a) => a.id !== id),
      contactsByAccount: { ...s.contactsByAccount, [id]: [] },
      actionsByAccount: { ...s.actionsByAccount, [id]: [] },
    }));
  },

  addContact: async (params) => {
    const { data, error } = await supabase.from('gtm_contacts').insert({
      gtm_account_id: params.gtmAccountId,
      name: params.name.trim(),
      title: params.title ?? null,
      email: params.email?.toLowerCase() ?? null,
      phone: params.phone ?? null,
      linkedin_url: params.linkedinUrl ?? null,
      relationship_owner: params.relationshipOwner?.toLowerCase() ?? null,
      last_touched: params.lastTouched ?? null,
      notes: params.notes ?? null,
    }).select().single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    const c = rowToContact(data);
    set((s) => ({
      contactsByAccount: { ...s.contactsByAccount, [c.gtmAccountId]: [...(s.contactsByAccount[c.gtmAccountId] ?? []), c] },
    }));
    return c;
  },

  updateContact: async (id, patch) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: Record<string, any> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) o.name = patch.name;
    if (patch.title !== undefined) o.title = patch.title;
    if (patch.email !== undefined) o.email = patch.email;
    if (patch.phone !== undefined) o.phone = patch.phone;
    if (patch.linkedinUrl !== undefined) o.linkedin_url = patch.linkedinUrl;
    if (patch.relationshipOwner !== undefined) o.relationship_owner = patch.relationshipOwner;
    if (patch.lastTouched !== undefined) o.last_touched = patch.lastTouched;
    if (patch.notes !== undefined) o.notes = patch.notes;
    const { data, error } = await supabase.from('gtm_contacts').update(o).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'update failed');
    const c = rowToContact(data);
    set((s) => ({
      contactsByAccount: {
        ...s.contactsByAccount,
        [c.gtmAccountId]: (s.contactsByAccount[c.gtmAccountId] ?? []).map((x) => (x.id === c.id ? c : x)),
      },
    }));
  },

  removeContact: async (id) => {
    const cur = Object.values(get().contactsByAccount).flat().find((x) => x.id === id);
    const { error } = await supabase.from('gtm_contacts').delete().eq('id', id);
    if (error) throw new Error(error.message);
    if (cur) {
      set((s) => ({
        contactsByAccount: {
          ...s.contactsByAccount,
          [cur.gtmAccountId]: (s.contactsByAccount[cur.gtmAccountId] ?? []).filter((x) => x.id !== id),
        },
      }));
    }
  },

  addAction: async (params) => {
    const { data, error } = await supabase.from('gtm_actions').insert({
      gtm_account_id: params.gtmAccountId,
      title: params.title.trim(),
      description: params.description ?? null,
      assignee_email: params.assigneeEmail?.toLowerCase() ?? null,
      due_date: params.dueDate ?? null,
      status: 'open',
      created_by: params.createdBy?.toLowerCase() ?? null,
    }).select().single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    const a = rowToAction(data);
    set((s) => ({
      actionsByAccount: { ...s.actionsByAccount, [a.gtmAccountId]: [a, ...(s.actionsByAccount[a.gtmAccountId] ?? [])] },
    }));
    return a;
  },

  updateAction: async (id, patch) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: Record<string, any> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) o.title = patch.title;
    if (patch.description !== undefined) o.description = patch.description;
    if (patch.assigneeEmail !== undefined) o.assignee_email = patch.assigneeEmail;
    if (patch.dueDate !== undefined) o.due_date = patch.dueDate;
    if (patch.status !== undefined) {
      o.status = patch.status;
      if (patch.status === 'done' && !patch.completedAt) o.completed_at = new Date().toISOString();
      if (patch.status !== 'done') o.completed_at = null;
    }
    const { data, error } = await supabase.from('gtm_actions').update(o).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'update failed');
    const a = rowToAction(data);
    set((s) => ({
      actionsByAccount: {
        ...s.actionsByAccount,
        [a.gtmAccountId]: (s.actionsByAccount[a.gtmAccountId] ?? []).map((x) => (x.id === a.id ? a : x)),
      },
    }));
  },

  removeAction: async (id) => {
    const cur = Object.values(get().actionsByAccount).flat().find((x) => x.id === id);
    const { error } = await supabase.from('gtm_actions').delete().eq('id', id);
    if (error) throw new Error(error.message);
    if (cur) {
      set((s) => ({
        actionsByAccount: {
          ...s.actionsByAccount,
          [cur.gtmAccountId]: (s.actionsByAccount[cur.gtmAccountId] ?? []).filter((x) => x.id !== id),
        },
      }));
    }
  },
}));

export type { GtmActionStatus };
