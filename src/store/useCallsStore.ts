/**
 * Outbound AI calling — Zustand store.
 *
 * Holds:
 *  - `templates`     — call_templates rows (questionnaire blueprints)
 *  - `calls`         — candidate_calls rows (one row per outbound call)
 *
 * Hydrates from Supabase on app init (App.tsx) and refreshes via the
 * realtime subscription wired in setupRealtimeSubscriptions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db } from '../lib/supabaseSync';
import type { CallTemplate, CandidateCall } from '../types/candidateCalls';

interface CallsState {
  templates: CallTemplate[];
  calls: CandidateCall[];

  setTemplates: (t: CallTemplate[]) => void;
  setCalls: (c: CandidateCall[]) => void;

  /** Trigger an outbound AI call. Returns the new candidate_calls row id. */
  startCall: (params: {
    candidateId: string;
    templateId?: string;
    roleTitle?: string;
    triggeredBy?: string;
  }) => Promise<{ ok: true; callId: string } | { ok: false; error: string }>;

  /** Find the most recent call for a candidate (any status). */
  latestCallFor: (candidateId: string) => CandidateCall | undefined;
}

export const useCallsStore = create<CallsState>()(
  persist(
    (set, get) => ({
      templates: [],
      calls: [],

      setTemplates: (templates) => set({ templates }),
      setCalls: (calls) => set({ calls }),

      startCall: async (params) => db.startCandidateCall(params),

      latestCallFor: (candidateId) => {
        const matching = get().calls
          .filter((c) => c.candidateId === candidateId)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        return matching[0];
      },
    }),
    {
      name: 'simpliigence-calls',
      version: 1,
    },
  ),
);
