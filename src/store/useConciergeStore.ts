/**
 * Concierge tickets store — native ticketing (Microsoft Graph inbound).
 *
 * Source of truth: Supabase `tickets` + `ticket_messages` + `ticket_time_entries`.
 * Emails delivered to the desk mailbox flow through the `desk-inbound` edge
 * function, which upserts into these tables. Manual tickets and the drawer
 * write through this store directly.
 *
 * The store still exposes `refreshFromZoho()` — kept for the legacy Refresh
 * button while Zoho Desk sync is being ripped out. New code should not call it.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const nanoid = (len = 21): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
};

export interface ConciergeTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  /** Open / On Hold / Escalated / Resolved / Closed */
  status: string;
  priority: string | null;
  account: string;
  accountId: string | null;
  channel: string;
  createdTime: string;
  dueDate: string | null;
  webUrl: string;
  threadCount: number;
  commentCount: number;
  // native ticketing fields
  assigneeEmail: string | null;
  description: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  hoursLogged: number;
  source: 'email' | 'manual' | 'api' | 'zoho_desk_legacy';
  senderEmail: string | null;
  senderName: string | null;
  graphMessageId: string | null;
  graphConversationId: string | null;
}

export interface ConciergeTicketMessage {
  id: string;
  ticketId: string;
  direction: 'inbound' | 'outbound' | 'internal_note' | 'system';
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string;
  createdBy: string | null;
}

export interface ConciergeTimeEntry {
  id: string;
  ticketId: string;
  userEmail: string;
  hours: number;
  notes: string | null;
  loggedAt: string;
}

export interface GraphSubscription {
  id: string;
  resource: string;
  expiresAt: string;
  active: boolean;
  lastRenewedAt: string | null;
}

interface ConciergeState {
  tickets: ConciergeTicket[];
  messagesByTicket: Record<string, ConciergeTicketMessage[]>;
  timeEntriesByTicket: Record<string, ConciergeTimeEntry[]>;
  graphSubscriptions: GraphSubscription[];
  graphConfigured: boolean | null; // null = unknown, true/false after status check
  lastSynced: string | null;
  lastSyncOk: boolean;
  lastSyncError: string | null;
  refreshing: boolean;
  loading: boolean;

  loadFromSupabase: () => Promise<void>;
  loadMessages: (ticketId: string) => Promise<void>;
  loadTimeEntries: (ticketId: string) => Promise<void>;
  checkGraphSubscription: () => Promise<{ ok: boolean; configured: boolean; message?: string }>;
  setupGraphSubscription: (mailbox?: string) => Promise<{ ok: boolean; message?: string }>;
  renewGraphSubscription: (id: string) => Promise<{ ok: boolean; message?: string }>;
  createTicket: (input: {
    subject: string;
    description?: string;
    priority?: string;
    account?: string | null;
    accountId?: string | null;
    assigneeEmail?: string | null;
    senderEmail?: string | null;
    senderName?: string | null;
  }) => Promise<{ ok: boolean; id?: string; message?: string }>;
  updateTicket: (id: string, patch: Partial<Pick<ConciergeTicket,
    'assigneeEmail' | 'priority' | 'status' | 'account' | 'accountId' | 'dueDate' | 'subject' | 'description' | 'resolution'
  >>) => Promise<void>;
  addInternalNote: (ticketId: string, body: string, author: string) => Promise<void>;
  logHours: (ticketId: string, hours: number, notes: string, userEmail: string) => Promise<void>;
  resolveTicket: (id: string, resolution: string) => Promise<void>;
  reopenTicket: (id: string) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;

  refreshFromZoho: () => Promise<{ ok: boolean; message?: string; count?: number }>;
  setTickets: (tickets: ConciergeTicket[]) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTicket(row: any): ConciergeTicket {
  return {
    id: row.id,
    ticketNumber: row.ticket_number ?? '',
    subject: row.subject ?? '',
    status: row.status ?? 'Open',
    priority: row.priority ?? null,
    account: row.account ?? '',
    accountId: row.account_id ?? null,
    channel: row.channel ?? '',
    createdTime: row.created_time ?? row.created_at ?? '',
    dueDate: row.due_date ?? null,
    webUrl: row.web_url ?? '',
    threadCount: row.thread_count ?? 0,
    commentCount: row.comment_count ?? 0,
    assigneeEmail: row.assignee_email ?? null,
    description: row.description ?? null,
    resolution: row.resolution ?? null,
    resolvedAt: row.resolved_at ?? null,
    hoursLogged: Number(row.hours_logged ?? 0),
    source: (row.source ?? 'zoho_desk_legacy') as ConciergeTicket['source'],
    senderEmail: row.sender_email ?? null,
    senderName: row.sender_name ?? null,
    graphMessageId: row.graph_message_id ?? null,
    graphConversationId: row.graph_conversation_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMessage(row: any): ConciergeTicketMessage {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    direction: row.direction,
    fromEmail: row.from_email ?? null,
    fromName: row.from_name ?? null,
    toEmails: row.to_emails ?? [],
    ccEmails: row.cc_emails ?? [],
    subject: row.subject ?? null,
    bodyText: row.body_text ?? null,
    bodyHtml: row.body_html ?? null,
    receivedAt: row.received_at ?? row.created_at ?? '',
    createdBy: row.created_by ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTimeEntry(row: any): ConciergeTimeEntry {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    userEmail: row.user_email,
    hours: Number(row.hours),
    notes: row.notes ?? null,
    loggedAt: row.logged_at ?? row.created_at ?? '',
  };
}

export const useConciergeStore = create<ConciergeState>((set, get) => ({
  tickets: [],
  messagesByTicket: {},
  timeEntriesByTicket: {},
  graphSubscriptions: [],
  graphConfigured: null,
  lastSynced: null,
  lastSyncOk: true,
  lastSyncError: null,
  refreshing: false,
  loading: false,

  loadFromSupabase: async () => {
    set({ loading: true });
    try {
      const [{ data: rows, error: e1 }, { data: syncRow, error: e2 }] = await Promise.all([
        supabase.from('tickets').select('*').order('created_time', { ascending: false }),
        supabase.from('sync_status').select('*').eq('source', 'zoho_desk_tickets').maybeSingle(),
      ]);
      if (e1) console.warn('[concierge] load tickets failed:', e1.message);
      if (e2 && e2.code !== 'PGRST116') console.warn('[concierge] load sync_status failed:', e2.message);
      set({
        tickets: (rows ?? []).map(rowToTicket),
        lastSynced: syncRow?.last_synced_at ?? null,
        lastSyncOk: syncRow?.last_ok ?? true,
        lastSyncError: syncRow?.last_error ?? null,
      });
    } finally {
      set({ loading: false });
    }
  },

  loadMessages: async (ticketId) => {
    const { data, error } = await supabase.from('ticket_messages').select('*')
      .eq('ticket_id', ticketId).order('received_at', { ascending: true });
    if (error) { console.warn('[concierge] loadMessages:', error.message); return; }
    set((s) => ({ messagesByTicket: { ...s.messagesByTicket, [ticketId]: (data ?? []).map(rowToMessage) } }));
  },

  loadTimeEntries: async (ticketId) => {
    const { data, error } = await supabase.from('ticket_time_entries').select('*')
      .eq('ticket_id', ticketId).order('logged_at', { ascending: false });
    if (error) { console.warn('[concierge] loadTimeEntries:', error.message); return; }
    set((s) => ({ timeEntriesByTicket: { ...s.timeEntriesByTicket, [ticketId]: (data ?? []).map(rowToTimeEntry) } }));
  },

  checkGraphSubscription: async () => {
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean; subscriptions?: unknown[]; message?: string; error?: string;
      }>('desk-graph-setup', { body: { action: 'status' } });
      if (error) return { ok: false, configured: false, message: error.message };
      if (data?.ok === false) {
        set({ graphConfigured: false });
        return { ok: false, configured: false, message: data.message || data.error };
      }
      const subs = (data?.subscriptions ?? []) as GraphSubscription[];
      set({ graphSubscriptions: subs, graphConfigured: true });
      return { ok: true, configured: true };
    } catch (err) {
      return { ok: false, configured: false, message: err instanceof Error ? err.message : String(err) };
    }
  },

  setupGraphSubscription: async (mailbox) => {
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; message?: string }>(
      'desk-graph-setup', { body: { action: 'create', mailbox } });
    if (error) return { ok: false, message: error.message };
    if (data?.ok === false) return { ok: false, message: data.error || data.message };
    await get().checkGraphSubscription();
    return { ok: true };
  },

  renewGraphSubscription: async (id) => {
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
      'desk-graph-setup', { body: { action: 'renew', id } });
    if (error) return { ok: false, message: error.message };
    if (data?.ok === false) return { ok: false, message: data.error };
    await get().checkGraphSubscription();
    return { ok: true };
  },

  createTicket: async (input) => {
    const { data: recent } = await supabase.from('tickets').select('ticket_number')
      .order('created_at', { ascending: false }).limit(50);
    let nextNumber = 1;
    for (const r of (recent || [])) {
      const n = parseInt(r.ticket_number, 10);
      if (Number.isFinite(n) && n >= nextNumber) nextNumber = n + 1;
    }
    const id = nanoid();
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('tickets').insert({
      id,
      ticket_number: String(nextNumber),
      subject: input.subject,
      description: input.description ?? null,
      status: 'Open',
      priority: input.priority ?? 'medium',
      account: input.account ?? null,
      account_id: input.accountId ?? null,
      assignee_email: input.assigneeEmail ?? null,
      sender_email: input.senderEmail ?? null,
      sender_name: input.senderName ?? null,
      source: 'manual',
      created_time: nowIso,
      last_synced_at: nowIso,
    });
    if (error) return { ok: false, message: error.message };
    await get().loadFromSupabase();
    return { ok: true, id };
  },

  updateTicket: async (id, patch) => {
    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('assigneeEmail' in patch) row.assignee_email = patch.assigneeEmail;
    if ('priority' in patch) row.priority = patch.priority;
    if ('status' in patch) row.status = patch.status;
    if ('account' in patch) row.account = patch.account;
    if ('accountId' in patch) row.account_id = patch.accountId;
    if ('dueDate' in patch) row.due_date = patch.dueDate;
    if ('subject' in patch) row.subject = patch.subject;
    if ('description' in patch) row.description = patch.description;
    if ('resolution' in patch) row.resolution = patch.resolution;
    const { error } = await supabase.from('tickets').update(row).eq('id', id);
    if (error) { console.warn('[concierge] updateTicket:', error.message); return; }
    set((s) => ({
      tickets: s.tickets.map((t) => t.id === id ? { ...t, ...patch } as ConciergeTicket : t),
    }));
  },

  addInternalNote: async (ticketId, body, author) => {
    const nowIso = new Date().toISOString();
    const id = nanoid();
    const { error } = await supabase.from('ticket_messages').insert({
      id, ticket_id: ticketId, direction: 'internal_note',
      from_email: author, from_name: author, body_text: body, received_at: nowIso, created_by: author,
    });
    if (error) { console.warn('[concierge] addInternalNote:', error.message); return; }
    await get().loadMessages(ticketId);
  },

  logHours: async (ticketId, hours, notes, userEmail) => {
    const id = nanoid();
    const { error } = await supabase.from('ticket_time_entries').insert({
      id, ticket_id: ticketId, user_email: userEmail, hours, notes: notes || null,
      logged_at: new Date().toISOString(),
    });
    if (error) { console.warn('[concierge] logHours:', error.message); return; }
    // Trigger will recompute tickets.hours_logged; reload the ticket + entries
    await Promise.all([get().loadTimeEntries(ticketId), get().loadFromSupabase()]);
  },

  resolveTicket: async (id, resolution) => {
    const nowIso = new Date().toISOString();
    const { error } = await supabase.from('tickets').update({
      status: 'Resolved', resolution, resolved_at: nowIso, updated_at: nowIso,
    }).eq('id', id);
    if (error) { console.warn('[concierge] resolveTicket:', error.message); return; }
    set((s) => ({
      tickets: s.tickets.map((t) => t.id === id ? { ...t, status: 'Resolved', resolution, resolvedAt: nowIso } : t),
    }));
  },

  reopenTicket: async (id) => {
    const { error } = await supabase.from('tickets').update({
      status: 'Open', resolution: null, resolved_at: null, updated_at: new Date().toISOString(),
    }).eq('id', id);
    if (error) { console.warn('[concierge] reopenTicket:', error.message); return; }
    set((s) => ({
      tickets: s.tickets.map((t) => t.id === id ? { ...t, status: 'Open', resolution: null, resolvedAt: null } : t),
    }));
  },

  deleteTicket: async (id) => {
    // Cascade any child rows first (messages, hours, notes) so we don't
    // leave orphans behind. Best-effort — if a table doesn't exist the
    // errors are logged and swallowed rather than aborting the delete.
    for (const child of ['ticket_messages', 'ticket_hours_log', 'ticket_internal_notes'] as const) {
      const { error: cErr } = await supabase.from(child).delete().eq('ticket_id', id);
      if (cErr) console.warn(`[concierge] deleteTicket ${child}:`, cErr.message);
    }
    const { error } = await supabase.from('tickets').delete().eq('id', id);
    if (error) { console.warn('[concierge] deleteTicket:', error.message); throw new Error(error.message); }
    set((s) => ({ tickets: s.tickets.filter((t) => t.id !== id) }));
  },

  refreshFromZoho: async () => {
    set({ refreshing: true });
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean; error?: string; message?: string; count?: number;
      }>('zoho-desk-sync', { body: {} });
      await get().loadFromSupabase();
      if (error) return { ok: false, message: error.message };
      if (data?.ok === false) return { ok: false, message: data.error || data.message || 'Refresh returned no data' };
      return { ok: true, count: data?.count };
    } finally {
      set({ refreshing: false });
    }
  },

  setTickets: (tickets) => set({ tickets, lastSynced: new Date().toISOString() }),
}));
