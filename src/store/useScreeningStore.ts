/**
 * Recruiter screening store — CRUD + edge-fn wrappers around `screenings`.
 * Not persisted locally; every read is from Supabase so multiple recruiters
 * see the same working record.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
  Screening,
  ScreeningCriterion,
  ScreeningEvaluation,
  ScreeningQuestion,
  ScreeningStatus,
  RequisitionSource,
  RecruiterObservations,
} from '../types/screening';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToScreening(r: any): Screening {
  return {
    id: r.id,
    requisitionId: r.requisition_id ?? null,
    requisitionSource: r.requisition_source,
    requisitionTitle: r.requisition_title ?? null,
    accountName: r.account_name ?? null,
    jd: r.jd ?? '',
    criteria: Array.isArray(r.criteria) ? r.criteria : [],
    roleFocus: r.role_focus ?? null,
    candidateProfile: r.candidate_profile ?? '',
    candidateName: r.candidate_name ?? null,
    generatedQuestions: Array.isArray(r.generated_questions) ? r.generated_questions : [],
    transcript: r.transcript ?? null,
    recruiterObservations: r.recruiter_observations ?? null,
    evaluation: r.evaluation ?? null,
    status: r.status,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface State {
  screenings: Screening[];
  loading: boolean;
  loadedAt: string | null;

  loadAll: () => Promise<void>;

  create: (params: {
    requisitionSource: RequisitionSource;
    requisitionId?: string | null;
    requisitionTitle?: string | null;
    accountName?: string | null;
    jd: string;
    criteria: ScreeningCriterion[];
    roleFocus?: string | null;
    candidateProfile: string;
    candidateName?: string | null;
    createdBy?: string | null;
  }) => Promise<Screening>;

  update: (id: string, patch: {
    jd?: string;
    criteria?: ScreeningCriterion[];
    roleFocus?: string | null;
    candidateProfile?: string;
    candidateName?: string | null;
    transcript?: string;
    recruiterObservations?: RecruiterObservations | null;
    status?: ScreeningStatus;
  }) => Promise<void>;

  remove: (id: string) => Promise<void>;

  generateQuestions: (id: string) => Promise<ScreeningQuestion[]>;
  evaluate: (id: string) => Promise<ScreeningEvaluation>;
}

export const useScreeningStore = create<State>((set, get) => ({
  screenings: [],
  loading: false,
  loadedAt: null,

  loadAll: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.from('screenings').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      set({ screenings: (data ?? []).map(rowToScreening), loadedAt: new Date().toISOString() });
    } finally {
      set({ loading: false });
    }
  },

  create: async (params) => {
    const row = {
      requisition_source: params.requisitionSource,
      requisition_id: params.requisitionId ?? null,
      requisition_title: params.requisitionTitle ?? null,
      account_name: params.accountName ?? null,
      jd: params.jd,
      criteria: params.criteria,
      role_focus: params.roleFocus ?? null,
      candidate_profile: params.candidateProfile,
      candidate_name: params.candidateName ?? null,
      created_by: params.createdBy ?? null,
    };
    const { data, error } = await supabase.from('screenings').insert(row).select().single();
    if (error || !data) throw new Error(error?.message ?? 'insert failed');
    const s = rowToScreening(data);
    set((cur) => ({ screenings: [s, ...cur.screenings] }));
    return s;
  },

  update: async (id, patch) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dbPatch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (patch.jd !== undefined) dbPatch.jd = patch.jd;
    if (patch.criteria !== undefined) dbPatch.criteria = patch.criteria;
    if (patch.roleFocus !== undefined) dbPatch.role_focus = patch.roleFocus;
    if (patch.candidateProfile !== undefined) dbPatch.candidate_profile = patch.candidateProfile;
    if (patch.candidateName !== undefined) dbPatch.candidate_name = patch.candidateName;
    if (patch.transcript !== undefined) dbPatch.transcript = patch.transcript;
    if (patch.recruiterObservations !== undefined) dbPatch.recruiter_observations = patch.recruiterObservations;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    const { data, error } = await supabase.from('screenings').update(dbPatch).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'update failed');
    const s = rowToScreening(data);
    set((cur) => ({ screenings: cur.screenings.map((x) => (x.id === s.id ? s : x)) }));
  },

  remove: async (id) => {
    const { error } = await supabase.from('screenings').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((cur) => ({ screenings: cur.screenings.filter((x) => x.id !== id) }));
  },

  generateQuestions: async (id) => {
    const cur = get().screenings.find((s) => s.id === id);
    if (!cur) throw new Error('screening not found');
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string; questions?: ScreeningQuestion[] }>(
      'generate-screening-questions',
      { body: {
        jd: cur.jd,
        criteria: cur.criteria,
        candidateProfile: cur.candidateProfile,
        requisitionTitle: cur.requisitionTitle,
        candidateName: cur.candidateName,
        roleFocus: cur.roleFocus,
      } },
    );
    if (error) throw new Error(error.message);
    if (!data || data.ok === false) throw new Error(data?.error || 'generate failed');
    const questions = data.questions ?? [];
    const { data: updated, error: upErr } = await supabase
      .from('screenings')
      .update({ generated_questions: questions, status: 'questions_generated', updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (upErr || !updated) throw new Error(upErr?.message ?? 'save failed');
    const s = rowToScreening(updated);
    set((c) => ({ screenings: c.screenings.map((x) => (x.id === s.id ? s : x)) }));
    return questions;
  },

  evaluate: async (id) => {
    const cur = get().screenings.find((s) => s.id === id);
    if (!cur) throw new Error('screening not found');
    if (!cur.transcript?.trim()) throw new Error('transcript required before evaluation');
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; error?: string; evaluation?: ScreeningEvaluation }>(
      'evaluate-screening',
      { body: {
        jd: cur.jd,
        criteria: cur.criteria,
        candidateProfile: cur.candidateProfile,
        generatedQuestions: cur.generatedQuestions,
        transcript: cur.transcript,
        requisitionTitle: cur.requisitionTitle,
        candidateName: cur.candidateName,
        roleFocus: cur.roleFocus,
        recruiterObservations: cur.recruiterObservations ?? undefined,
      } },
    );
    if (error) throw new Error(error.message);
    if (!data || data.ok === false) throw new Error(data?.error || 'evaluate failed');
    const evaluation = data.evaluation!;
    const { data: updated, error: upErr } = await supabase
      .from('screenings')
      .update({ evaluation, status: 'evaluated', updated_at: new Date().toISOString() })
      .eq('id', id).select().single();
    if (upErr || !updated) throw new Error(upErr?.message ?? 'save failed');
    const s = rowToScreening(updated);
    set((c) => ({ screenings: c.screenings.map((x) => (x.id === s.id ? s : x)) }));
    return evaluation;
  },
}));
