/**
 * Concierge account documents + AI-synthesized profile.
 *
 * Wraps:
 *   - concierge_account_documents  (uploaded docs + meeting transcripts)
 *   - concierge_account_profile    (Claude-synthesized what-we-do + opps)
 *   - Supabase Storage bucket 'concierge-docs' (private)
 *   - Edge functions:
 *       process-account-document  → per-doc summary
 *       rebuild-account-profile   → aggregate profile
 *
 * Kept as a plain Zustand store (not persisted) so it always reflects the
 * server truth — AI status changes shouldn't be cached across reloads.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
  AccountDocument,
  AccountDocKind,
  AccountProfile,
} from '../types/concierge';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDoc(r: any): AccountDocument {
  return {
    id: r.id,
    accountId: r.account_id,
    kind: r.kind,
    title: r.title,
    filename: r.filename ?? null,
    storagePath: r.storage_path ?? null,
    mimeType: r.mime_type ?? null,
    sizeBytes: r.size_bytes ?? null,
    meetingDate: r.meeting_date ?? null,
    rawText: r.raw_text ?? null,
    aiStatus: r.ai_status ?? 'pending',
    aiSummary: r.ai_summary ?? null,
    aiTopics: r.ai_topics ?? null,
    aiError: r.ai_error ?? null,
    uploadedBy: r.uploaded_by ?? null,
    uploadedAt: r.uploaded_at,
    processedAt: r.processed_at ?? null,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProfile(r: any): AccountProfile {
  return {
    accountId: r.account_id,
    whatWeDo: r.what_we_do ?? null,
    keyStakeholders: Array.isArray(r.key_stakeholders) ? r.key_stakeholders : [],
    technologies: Array.isArray(r.technologies) ? r.technologies : [],
    currentInitiatives: Array.isArray(r.current_initiatives) ? r.current_initiatives : [],
    risks: Array.isArray(r.risks) ? r.risks : [],
    upsellOpportunities: Array.isArray(r.upsell_opportunities) ? r.upsell_opportunities : [],
    crossSellOpportunities: Array.isArray(r.cross_sell_opportunities) ? r.cross_sell_opportunities : [],
    sourceDocIds: Array.isArray(r.source_doc_ids) ? r.source_doc_ids : [],
    generatedAt: r.generated_at ?? null,
    updatedAt: r.updated_at,
  };
}

interface State {
  docsByAccount: Record<string, AccountDocument[]>;
  profileByAccount: Record<string, AccountProfile>;
  loadingByAccount: Record<string, boolean>;
  processingIds: Set<string>;
  profileBuilding: Set<string>;

  loadForAccount: (accountId: string) => Promise<void>;
  uploadFile: (params: { accountId: string; kind: AccountDocKind; file: File; title?: string; meetingDate?: string | null; uploadedBy?: string | null }) => Promise<AccountDocument>;
  addTranscript: (params: { accountId: string; title: string; text: string; meetingDate?: string | null; uploadedBy?: string | null }) => Promise<AccountDocument>;
  process: (documentId: string) => Promise<void>;
  remove: (documentId: string) => Promise<void>;
  signedUrl: (storagePath: string) => Promise<string | null>;
  rebuildProfile: (accountId: string) => Promise<void>;
}

export const useAccountDocsStore = create<State>((set, get) => ({
  docsByAccount: {},
  profileByAccount: {},
  loadingByAccount: {},
  processingIds: new Set(),
  profileBuilding: new Set(),

  loadForAccount: async (accountId) => {
    set((s) => ({ loadingByAccount: { ...s.loadingByAccount, [accountId]: true } }));
    try {
      const [docs, prof] = await Promise.all([
        supabase.from('concierge_account_documents').select('*').eq('account_id', accountId).order('uploaded_at', { ascending: false }),
        supabase.from('concierge_account_profile').select('*').eq('account_id', accountId).maybeSingle(),
      ]);
      if (!docs.error) {
        set((s) => ({ docsByAccount: { ...s.docsByAccount, [accountId]: (docs.data ?? []).map(rowToDoc) } }));
      }
      if (!prof.error && prof.data) {
        set((s) => ({ profileByAccount: { ...s.profileByAccount, [accountId]: rowToProfile(prof.data) } }));
      }
    } finally {
      set((s) => ({ loadingByAccount: { ...s.loadingByAccount, [accountId]: false } }));
    }
  },

  uploadFile: async ({ accountId, kind, file, title, meetingDate, uploadedBy }) => {
    const path = `${accountId}/${kind}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error: upErr } = await supabase.storage.from('concierge-docs').upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const insertRow = {
      account_id: accountId,
      kind,
      title: title || file.name,
      filename: file.name,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      meeting_date: meetingDate ?? null,
      uploaded_by: uploadedBy ?? null,
      ai_status: 'pending',
    };
    const { data, error } = await supabase.from('concierge_account_documents').insert(insertRow).select().single();
    if (error || !data) throw new Error(`Insert row failed: ${error?.message}`);
    const doc = rowToDoc(data);

    set((s) => ({
      docsByAccount: { ...s.docsByAccount, [accountId]: [doc, ...(s.docsByAccount[accountId] ?? [])] },
    }));

    // Fire-and-forget summarization
    void get().process(doc.id);
    return doc;
  },

  addTranscript: async ({ accountId, title, text, meetingDate, uploadedBy }) => {
    const { data, error } = await supabase.from('concierge_account_documents').insert({
      account_id: accountId,
      kind: 'meeting_transcript',
      title,
      filename: null,
      storage_path: null,
      mime_type: 'text/plain',
      size_bytes: text.length,
      meeting_date: meetingDate ?? null,
      raw_text: text,
      uploaded_by: uploadedBy ?? null,
      ai_status: 'pending',
    }).select().single();
    if (error || !data) throw new Error(`Insert transcript failed: ${error?.message}`);
    const doc = rowToDoc(data);
    set((s) => ({
      docsByAccount: { ...s.docsByAccount, [accountId]: [doc, ...(s.docsByAccount[accountId] ?? [])] },
    }));
    void get().process(doc.id);
    return doc;
  },

  process: async (documentId) => {
    set((s) => {
      const next = new Set(s.processingIds); next.add(documentId);
      return { processingIds: next };
    });
    // Optimistically mark processing in local state
    set((s) => {
      const next: Record<string, AccountDocument[]> = { ...s.docsByAccount };
      for (const acc of Object.keys(next)) {
        next[acc] = next[acc].map((d) => (d.id === documentId ? { ...d, aiStatus: 'processing' } : d));
      }
      return { docsByAccount: next };
    });

    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
        'process-account-document',
        { body: { documentId } },
      );
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error || 'Processing failed');

      // Reload the row to pick up ai_summary + ai_topics
      const { data: fresh } = await supabase.from('concierge_account_documents').select('*').eq('id', documentId).single();
      if (fresh) {
        const doc = rowToDoc(fresh);
        set((s) => {
          const arr = s.docsByAccount[doc.accountId] ?? [];
          return {
            docsByAccount: {
              ...s.docsByAccount,
              [doc.accountId]: arr.map((d) => (d.id === doc.id ? doc : d)),
            },
          };
        });
      }
    } catch (e) {
      // Reflect failure locally
      const msg = (e as Error).message;
      set((s) => {
        const next: Record<string, AccountDocument[]> = { ...s.docsByAccount };
        for (const acc of Object.keys(next)) {
          next[acc] = next[acc].map((d) => (d.id === documentId ? { ...d, aiStatus: 'failed', aiError: msg } : d));
        }
        return { docsByAccount: next };
      });
    } finally {
      set((s) => {
        const next = new Set(s.processingIds); next.delete(documentId);
        return { processingIds: next };
      });
    }
  },

  remove: async (documentId) => {
    // Look up storage_path so we can also delete the underlying file (best effort)
    const doc = Object.values(get().docsByAccount).flat().find((d) => d.id === documentId);
    if (doc?.storagePath) {
      await supabase.storage.from('concierge-docs').remove([doc.storagePath]);
    }
    const { error } = await supabase.from('concierge_account_documents').delete().eq('id', documentId);
    if (error) throw new Error(error.message);
    set((s) => {
      const next: Record<string, AccountDocument[]> = {};
      for (const [acc, arr] of Object.entries(s.docsByAccount)) next[acc] = arr.filter((d) => d.id !== documentId);
      return { docsByAccount: next };
    });
  },

  signedUrl: async (storagePath) => {
    const { data, error } = await supabase.storage.from('concierge-docs').createSignedUrl(storagePath, 3600);
    if (error || !data) return null;
    return data.signedUrl;
  },

  rebuildProfile: async (accountId) => {
    set((s) => { const next = new Set(s.profileBuilding); next.add(accountId); return { profileBuilding: next }; });
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string }>(
        'rebuild-account-profile',
        { body: { accountId } },
      );
      if (error) throw new Error(error.message);
      if (data && data.ok === false) throw new Error(data.error || 'Rebuild failed');
      // Reload profile
      const { data: fresh } = await supabase.from('concierge_account_profile').select('*').eq('account_id', accountId).maybeSingle();
      if (fresh) {
        set((s) => ({ profileByAccount: { ...s.profileByAccount, [accountId]: rowToProfile(fresh) } }));
      }
    } finally {
      set((s) => { const next = new Set(s.profileBuilding); next.delete(accountId); return { profileBuilding: next }; });
    }
  },
}));
