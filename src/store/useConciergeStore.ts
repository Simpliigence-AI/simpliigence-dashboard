/**
 * Concierge tickets store — real Zoho Desk sync (not seed).
 *
 * Source of truth: Supabase `tickets` table, populated by the
 * `zoho-desk-sync` edge function. Store hydrates from Supabase on mount
 * (see ConciergePage) and exposes `refreshFromZoho()` for the Refresh
 * button.
 *
 * The old SEED_TICKETS array + `lastSynced: new Date()` faked freshness
 * (data 3-6 months out of date, chip always said "today"). Gone.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface ConciergeTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  /** Zoho Desk statuses vary — UI treats Open/Escalated as danger,
   *  On Hold as warning. */
  status: string;
  priority: string | null;
  account: string;
  channel: string;
  createdTime: string;
  dueDate: string | null;
  webUrl: string;
  threadCount: number;
  commentCount: number;
}

interface ConciergeState {
  tickets: ConciergeTicket[];
  lastSynced: string | null;        // Real ISO from sync_status.last_synced_at
  lastSyncOk: boolean;
  lastSyncError: string | null;
  refreshing: boolean;               // Refresh button spinner
  loading: boolean;                  // initial hydrate

  loadFromSupabase: () => Promise<void>;
  refreshFromZoho: () => Promise<{ ok: boolean; message?: string; count?: number }>;
  /** Legacy — kept in case anything still calls it. New code should use refreshFromZoho. */
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
    channel: row.channel ?? '',
    createdTime: row.created_time ?? '',
    dueDate: row.due_date ?? null,
    webUrl: row.web_url ?? '',
    threadCount: row.thread_count ?? 0,
    commentCount: row.comment_count ?? 0,
  };
}

export const useConciergeStore = create<ConciergeState>((set, get) => ({
  tickets: [],
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

  refreshFromZoho: async () => {
    set({ refreshing: true });
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean; error?: string; message?: string; count?: number;
      }>('zoho-desk-sync', { body: {} });
      // Always reload — the edge fn writes sync_status even on failure.
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
