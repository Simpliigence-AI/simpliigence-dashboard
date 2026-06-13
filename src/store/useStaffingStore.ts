import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type {
  StaffingAccount,
  StaffingRequisition,
  DailyStatus,
  StaffingStatus,
  PipelineStage,
  StaffingHistoryEntry,
  StaffingCandidate,
} from '../types/staffing';
import { db } from '../lib/supabaseSync';
import { CLIENT_ID } from '../lib/supabase';
import { analyzeStaffingStatus } from '../lib/staffingAnalysis';

/* ── Helper: build default new-requisition fields ── */
const today = () => new Date().toISOString().slice(0, 10);

/* ── Seed data from original Staffing.xlsx ── */
const SEED_ACCOUNTS: StaffingAccount[] = [
  { id: 'acct-1', name: 'Acuity', created_at: '2026-03-01' },
  { id: 'acct-2', name: 'Amex', created_at: '2026-03-01' },
  { id: 'acct-3', name: 'Ciklum', created_at: '2026-03-01' },
  { id: 'acct-4', name: 'Ness', created_at: '2026-03-01' },
  { id: 'acct-5', name: 'Persistent', created_at: '2026-03-01' },
  { id: 'acct-6', name: 'Merck', created_at: '2026-03-01' },
];

const seedReq = (p: Partial<StaffingRequisition> & { id: string; account_id: string; title: string; month: string; new_positions: number; expected_closure: string; anticipation: string; created_at: string; updated_at: string; }): StaffingRequisition => ({
  start_date: p.created_at || '2026-03-01',
  close_by_date: '',
  status_field: 'In Progress' as StaffingStatus,
  stage: 'Sourcing' as PipelineStage,
  client_spoc: '',
  department: '',
  probability: 0,
  ai_probability: 0,
  ...p,
} as StaffingRequisition);

const SEED_REQS: StaffingRequisition[] = [
  seedReq({id:'r1',account_id:'acct-1',title:'Mixed (FSL Architect, Python+AI, .Net FullStack)',month:'March',new_positions:6,expected_closure:'March End',anticipation:'Expecting closures in early next week',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r2',account_id:'acct-2',title:'Product Owner',month:'March',new_positions:2,expected_closure:'March End',anticipation:'Expecting onboarding Mon/Early next week',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r3',account_id:'acct-3',title:'AI Architect - Healthcare',month:'March',new_positions:2,expected_closure:'March End',anticipation:'No hopes. Expecting the L1 Selection',created_at:'2026-03-01',updated_at:'2026-03-26'}),
  seedReq({id:'r4',account_id:'acct-3',title:'AI',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting client call - no hopes',created_at:'2026-03-01',updated_at:'2026-03-26'}),
  seedReq({id:'r5',account_id:'acct-3',title:'DevOps',month:'March',new_positions:2,expected_closure:'March End',anticipation:'No hopes. Expecting at least one selection',created_at:'2026-03-01',updated_at:'2026-03-25'}),
  seedReq({id:'r6',account_id:'acct-3',title:'Java',month:'March',new_positions:10,expected_closure:'March End',anticipation:'No hopes. Screening but no hopes on closures',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r7',account_id:'acct-4',title:'Support',month:'March',new_positions:4,expected_closure:'March End',anticipation:'Expecting the slots',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r8',account_id:'acct-4',title:'Developer',month:'March',new_positions:3,expected_closure:'March End',anticipation:'Expecting one more slot',created_at:'2026-03-01',updated_at:'2026-03-18'}),
  seedReq({id:'r9',account_id:'acct-4',title:'Lead',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting slots 03/23 or 03/24',created_at:'2026-03-01',updated_at:'2026-03-26'}),
  seedReq({id:'r10',account_id:'acct-5',title:'CPQ/Conga Architect',month:'March',new_positions:1,expected_closure:'Overdue',anticipation:'Expecting the onboarding date',created_at:'2026-03-01',updated_at:'2026-03-24'}),
  seedReq({id:'r11',account_id:'acct-5',title:'CPQ/Conga Developer',month:'March',new_positions:1,expected_closure:'Overdue',anticipation:'Expecting the onboarding date',created_at:'2026-03-01',updated_at:'2026-03-24'}),
  seedReq({id:'r12',account_id:'acct-5',title:'CPQ Architect + AI',month:'March',new_positions:1,expected_closure:'March End',anticipation:'No hopes. Expecting more slots',created_at:'2026-03-01',updated_at:'2026-03-26'}),
  seedReq({id:'r13',account_id:'acct-5',title:'CPQ Developer + AI',month:'March',new_positions:2,expected_closure:'March End',anticipation:'Expecting select or more client discussion',created_at:'2026-03-01',updated_at:'2026-03-25'}),
  seedReq({id:'r14',account_id:'acct-5',title:'LWC/Integration',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting the L1 slot',created_at:'2026-03-01',updated_at:'2026-03-26'}),
  seedReq({id:'r15',account_id:'acct-5',title:'Dev Lead - Salescloud, CPQ',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting at least 1 to hit',created_at:'2026-03-01',updated_at:'2026-03-26'}),
  seedReq({id:'r16',account_id:'acct-5',title:'Service Cloud Voice Tech Lead + Architect',month:'March',new_positions:2,expected_closure:'March End',anticipation:'R1 should clear',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r17',account_id:'acct-5',title:'SF Architect (Sales, Conga CPQ, CLM)',month:'March',new_positions:1,expected_closure:'March End',anticipation:'No hopes. Expecting clarity on role',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r18',account_id:'acct-5',title:'SF Automation QA (ACCELQ)',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting the slots',created_at:'2026-03-01',updated_at:'2026-03-24'}),
  seedReq({id:'r19',account_id:'acct-5',title:'Salesforce Agentforce (7+ Yrs)',month:'March',new_positions:1,expected_closure:'March End',anticipation:'No hopes. Expecting L1 Selection',created_at:'2026-03-01',updated_at:'2026-03-25'}),
  seedReq({id:'r20',account_id:'acct-5',title:'SF Vlocity',month:'March',new_positions:1,expected_closure:'March End',anticipation:'No hopes. Expecting L1 Selection',created_at:'2026-03-01',updated_at:'2026-03-18'}),
  seedReq({id:'r21',account_id:'acct-6',title:'SF Developer',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting client discussion',created_at:'2026-03-01',updated_at:'2026-03-27'}),
  seedReq({id:'r22',account_id:'acct-6',title:'SF Service Cloud CTI',month:'March',new_positions:1,expected_closure:'March End',anticipation:'Expecting client discussion',created_at:'2026-03-01',updated_at:'2026-03-23'}),
  // April — only genuinely NEW positions (not carried over from March)
  seedReq({id:'r23',account_id:'acct-1',title:'SF Architect / Python+AI / Solution Architect',month:'April',new_positions:3,expected_closure:'7th April',anticipation:'Python+AI shall close one of 3 proposed',created_at:'2026-04-01',updated_at:'2026-04-02'}),
];

const SEED_STATUSES: DailyStatus[] = [
  {id:'s1',requisition_id:'r1',status_date:'2026-03-27',status_text:'Got an FSL Architect position; Python+AI 2 interviews scheduled',anticipation:'Expecting closures early next week',created_at:'2026-03-27'},
  {id:'s2',requisition_id:'r1',status_date:'2026-03-26',status_text:'Closed 2 .Net Full Stack positions & working on Python+AI',anticipation:'Targeting to close today/tomorrow',created_at:'2026-03-26'},
  {id:'s3',requisition_id:'r1',status_date:'2026-03-25',status_text:'Full Stack interviews scheduled & working on Python+AI',anticipation:'',created_at:'2026-03-25'},
  {id:'s4',requisition_id:'r1',status_date:'2026-03-18',status_text:'1 .Net FullStack Select',anticipation:'',created_at:'2026-03-18'},
  {id:'s5',requisition_id:'r1',status_date:'2026-03-17',status_text:'1 .Net closed, 2 .Net FullStack in Client Evaluation, 1 Python in Screening',anticipation:'',created_at:'2026-03-17'},
  {id:'s6',requisition_id:'r2',status_date:'2026-03-27',status_text:'Closed 2 positions & working on onboarding process',anticipation:'Onboarding Mon/Early next week',created_at:'2026-03-27'},
  {id:'s7',requisition_id:'r2',status_date:'2026-03-24',status_text:'1 Select (Rashmi for senior PO), other scheduled. Got verbal communication',anticipation:'',created_at:'2026-03-24'},
  {id:'s8',requisition_id:'r2',status_date:'2026-03-23',status_text:'Got slots for 2 candidates - 03/24 & 03/26',anticipation:'',created_at:'2026-03-23'},
  {id:'s9',requisition_id:'r2',status_date:'2026-03-17',status_text:'Shared profiles',anticipation:'',created_at:'2026-03-17'},
  {id:'s10',requisition_id:'r6',status_date:'2026-03-27',status_text:'1 In Client round & 2 Need client slots',anticipation:'No hopes on closures',created_at:'2026-03-27'},
  {id:'s11',requisition_id:'r6',status_date:'2026-03-26',status_text:'6 Evaluations done - 3 select for next round',anticipation:'',created_at:'2026-03-26'},
  {id:'s12',requisition_id:'r6',status_date:'2026-03-24',status_text:'Got slots for 12 folks',anticipation:'',created_at:'2026-03-24'},
  {id:'s13',requisition_id:'r6',status_date:'2026-03-17',status_text:'Planning to share 09 profiles',anticipation:'',created_at:'2026-03-17'},
  {id:'s14',requisition_id:'r7',status_date:'2026-03-27',status_text:'1 Select out of 3 & Need more profiles',anticipation:'',created_at:'2026-03-27'},
  {id:'s15',requisition_id:'r7',status_date:'2026-03-26',status_text:'2 Interviews done, 1 select for next round',anticipation:'',created_at:'2026-03-26'},
  {id:'s16',requisition_id:'r23',status_date:'2026-04-02',status_text:'SF Architect: Shared 4 profiles. Python+AI: Awaiting feedback. 2 Backfill interviews in place',anticipation:'Python+AI shall close one of 3',created_at:'2026-04-02'},
  {id:'s17',requisition_id:'r2',status_date:'2026-04-02',status_text:'Identified Resources & Working on onboarding Process',anticipation:'In Onboarding discussion',created_at:'2026-04-02'},
  {id:'s18',requisition_id:'r2',status_date:'2026-04-01',status_text:'In Onboarding discussion',anticipation:'',created_at:'2026-04-01'},
  {id:'s19',requisition_id:'r6',status_date:'2026-04-02',status_text:'Ciklum TA working on high priority tasks. Need time to move forward',anticipation:'No hopes',created_at:'2026-04-02'},
  {id:'s20',requisition_id:'r6',status_date:'2026-04-01',status_text:'No News from Client',anticipation:'',created_at:'2026-04-01'},
  {id:'s21',requisition_id:'r7',status_date:'2026-04-02',status_text:'Shared 5 profiles on 04/01, 1 Candidate Reject',anticipation:'',created_at:'2026-04-02'},
  {id:'s22',requisition_id:'r8',status_date:'2026-04-02',status_text:'1 R2 clear & put across client round',anticipation:'Targeting to close in April',created_at:'2026-04-02'},
  {id:'s23',requisition_id:'r19',status_date:'2026-04-02',status_text:'Client Select & Awaiting Final feedback',anticipation:'Expecting L1 Selection',created_at:'2026-04-02'},
  {id:'s24',requisition_id:'r22',status_date:'2026-04-01',status_text:'Select - got the confirmation',anticipation:'Onboarding 3-4 weeks',created_at:'2026-04-01'},
];

/** Fields we audit on a requisition. Any change to these writes a StaffingHistoryEntry. */
const AUDITED_FIELDS: (keyof StaffingRequisition)[] = [
  'title', 'account_id', 'month', 'new_positions', 'expected_closure',
  'start_date', 'close_by_date', 'status_field', 'stage', 'anticipation',
  'client_spoc', 'department', 'probability', 'ai_probability',
];

/** Re-compute AI probability from linked statuses. */
function computeAiProbability(req: StaffingRequisition, statuses: DailyStatus[]): number {
  const reqStatuses = statuses
    .filter((s) => s.requisition_id === req.id)
    .sort((a, b) => b.status_date.localeCompare(a.status_date));
  const combinedStatus = reqStatuses.map((s) => `${s.status_date.slice(5).replace('-', '/')}: ${s.status_text}`).join('\n');
  const latestAnticipation = reqStatuses[0]?.anticipation || req.anticipation;
  return analyzeStaffingStatus(combinedStatus, latestAnticipation).score;
}

/* ── Store shape ── */
interface StaffingState {
  accounts: StaffingAccount[];
  requisitions: StaffingRequisition[];
  statuses: DailyStatus[];
  history: StaffingHistoryEntry[];
  candidates: StaffingCandidate[];

  addAccount: (name: string) => StaffingAccount;
  removeAccount: (id: string) => void;

  addRequisition: (req: Omit<StaffingRequisition, 'id' | 'created_at' | 'updated_at' | 'ai_probability'> & Partial<Pick<StaffingRequisition, 'ai_probability'>>) => StaffingRequisition;
  updateRequisition: (id: string, patch: Partial<StaffingRequisition>) => void;
  removeRequisition: (id: string) => void;

  addStatus: (s: Omit<DailyStatus, 'id' | 'created_at'>) => DailyStatus;
  removeStatus: (id: string) => void;

  addCandidate: (c: Omit<StaffingCandidate, 'id' | 'created_at' | 'updated_at'>) => StaffingCandidate;
  updateCandidate: (id: string, patch: Partial<StaffingCandidate>) => void;
  removeCandidate: (id: string) => void;
  /** Get all candidates for a specific requisition, newest first. */
  candidatesFor: (requisitionId: string) => StaffingCandidate[];

  /** Read-only helper: get history rows for a specific requisition, newest first. */
  historyFor: (requisitionId: string) => StaffingHistoryEntry[];

  importRows: (rows: Array<{
    month: string; account: string; requisition: string;
    new_positions: number; expected_closure: string;
    status_text: string; anticipation: string;
  }>) => { imported: number; errors: string[] };

  /** Internal: called by realtime subscriptions to hydrate from Supabase */
  _setFromSupabase: (
    accounts: StaffingAccount[],
    requisitions: StaffingRequisition[],
    statuses: DailyStatus[],
    history?: StaffingHistoryEntry[],
    candidates?: StaffingCandidate[],
  ) => void;
}

export const useStaffingStore = create<StaffingState>()(
  persist(
    (set, get) => ({
      accounts: SEED_ACCOUNTS,
      requisitions: SEED_REQS,
      statuses: SEED_STATUSES,
      history: [],
      candidates: [],

      addAccount: (name) => {
        const acct: StaffingAccount = { id: nanoid(), name, created_at: new Date().toISOString() };
        set((s) => ({ accounts: [...s.accounts, acct] }));
        db.upsertIndiaAccount(acct);
        return acct;
      },

      removeAccount: (id) => {
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          requisitions: s.requisitions.filter((r) => r.account_id !== id),
          statuses: s.statuses.filter(
            (st) => !s.requisitions.filter((r) => r.account_id === id).some((r) => r.id === st.requisition_id),
          ),
        }));
        db.deleteIndiaAccount(id);
      },

      addRequisition: (req) => {
        const now = new Date().toISOString();
        const r: StaffingRequisition = {
          ...req,
          ai_probability: req.ai_probability ?? 0,
          id: nanoid(),
          created_at: now,
          updated_at: now,
        };
        set((s) => ({ requisitions: [...s.requisitions, r] }));
        db.upsertIndiaRequisition(r);
        return r;
      },

      updateRequisition: (id, patch) => {
        const prev = get().requisitions.find((r) => r.id === id);
        if (!prev) return;

        // Build history entries for every audited field whose value actually changed
        const now = new Date().toISOString();
        const newHistory: StaffingHistoryEntry[] = [];
        for (const field of AUDITED_FIELDS) {
          if (!(field in patch)) continue;
          const oldVal = prev[field];
          const newVal = (patch as Record<string, unknown>)[field];
          if (oldVal === newVal) continue;
          newHistory.push({
            id: nanoid(),
            requisition_id: id,
            field: String(field),
            old_value: oldVal == null ? '' : String(oldVal),
            new_value: newVal == null ? '' : String(newVal),
            changed_at: now,
            changed_by: CLIENT_ID,
          });
        }

        set((s) => ({
          requisitions: s.requisitions.map((r) =>
            r.id === id ? { ...r, ...patch, updated_at: now } : r,
          ),
          history: [...s.history, ...newHistory],
        }));
        const updated = get().requisitions.find((r) => r.id === id);
        if (updated) db.upsertIndiaRequisition(updated);
        if (newHistory.length) db.insertIndiaHistory(newHistory);
      },

      removeRequisition: (id) => {
        set((s) => ({
          requisitions: s.requisitions.filter((r) => r.id !== id),
          statuses: s.statuses.filter((st) => st.requisition_id !== id),
          candidates: s.candidates.filter((c) => c.requisition_id !== id),
          // keep history entries so deletions remain auditable
        }));
        db.deleteIndiaRequisition(id);
      },

      addStatus: (input) => {
        const ds: DailyStatus = { ...input, id: nanoid(), created_at: new Date().toISOString() };
        set((s) => {
          const nextStatuses = [...s.statuses, ds];
          // Re-score AI probability for the affected requisition
          const req = s.requisitions.find((r) => r.id === ds.requisition_id);
          if (!req) return { statuses: nextStatuses };
          const newAi = computeAiProbability(req, nextStatuses);
          if (newAi === req.ai_probability) return { statuses: nextStatuses };
          const now = new Date().toISOString();
          const histEntry: StaffingHistoryEntry = {
            id: nanoid(),
            requisition_id: req.id,
            field: 'ai_probability',
            old_value: String(req.ai_probability ?? 0),
            new_value: String(newAi),
            changed_at: now,
            changed_by: CLIENT_ID,
          };
          const updatedReq = { ...req, ai_probability: newAi, updated_at: now };
          // Fire-and-forget persistence outside set()
          queueMicrotask(() => {
            db.upsertIndiaRequisition(updatedReq);
            db.insertIndiaHistory([histEntry]);
          });
          return {
            statuses: nextStatuses,
            requisitions: s.requisitions.map((r) => (r.id === req.id ? updatedReq : r)),
            history: [...s.history, histEntry],
          };
        });
        db.upsertIndiaStatus(ds);
        return ds;
      },

      removeStatus: (id) => {
        set((s) => ({ statuses: s.statuses.filter((st) => st.id !== id) }));
        db.deleteIndiaStatus(id);
      },

      historyFor: (requisitionId) =>
        get().history
          .filter((h) => h.requisition_id === requisitionId)
          .sort((a, b) => b.changed_at.localeCompare(a.changed_at)),

      addCandidate: (input) => {
        const now = new Date().toISOString();
        const c: StaffingCandidate = {
          ...input,
          id: nanoid(),
          created_at: now,
          updated_at: now,
        };
        set((s) => ({ candidates: [...s.candidates, c] }));
        db.upsertIndiaCandidate(c);
        return c;
      },

      updateCandidate: (id, patch) => {
        set((s) => ({
          candidates: s.candidates.map((c) =>
            c.id === id ? { ...c, ...patch, updated_at: new Date().toISOString() } : c,
          ),
        }));
        const updated = get().candidates.find((c) => c.id === id);
        if (updated) db.upsertIndiaCandidate(updated);
      },

      removeCandidate: (id) => {
        set((s) => ({ candidates: s.candidates.filter((c) => c.id !== id) }));
        db.deleteIndiaCandidate(id);
      },

      candidatesFor: (requisitionId) =>
        get().candidates
          .filter((c) => c.requisition_id === requisitionId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),

      importRows: (rows) => {
        const state = get();
        let imported = 0;
        const errors: string[] = [];
        const newAccounts = [...state.accounts];
        const newReqs = [...state.requisitions];
        const newStatuses = [...state.statuses];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          try {
            if (!row.account || !row.requisition) {
              errors.push(`Row ${i + 1}: missing account or requisition`);
              continue;
            }
            let acct = newAccounts.find((a) => a.name === row.account);
            if (!acct) {
              acct = { id: nanoid(), name: row.account, created_at: new Date().toISOString() };
              newAccounts.push(acct);
            }
            let req = newReqs.find(
              (r) => r.account_id === acct!.id && r.title === row.requisition && r.month === row.month,
            );
            if (!req) {
              req = newReqs.find(
                (r) =>
                  r.account_id === acct!.id &&
                  r.title === row.requisition &&
                  r.status_field !== 'Closed' &&
                  r.status_field !== 'Cancelled' &&
                  r.status_field !== 'Lost',
              );
              if (req) {
                req.month = row.month;
                req.updated_at = new Date().toISOString();
                if (row.new_positions) req.new_positions = row.new_positions;
                if (row.expected_closure) req.expected_closure = row.expected_closure;
                if (row.anticipation) req.anticipation = row.anticipation;
              }
            }
            if (!req) {
              const now = new Date().toISOString();
              req = {
                id: nanoid(), account_id: acct.id, title: row.requisition, month: row.month,
                new_positions: row.new_positions || 0,
                expected_closure: row.expected_closure || '',
                start_date: today(),
                close_by_date: '',
                status_field: 'Open' as StaffingStatus,
                stage: 'Sourcing' as PipelineStage,
                anticipation: row.anticipation || '',
                client_spoc: '', department: '',
                probability: 0,
                ai_probability: 0,
                created_at: now, updated_at: now,
              };
              newReqs.push(req);
            }
            if (row.status_text) {
              newStatuses.push({
                id: nanoid(), requisition_id: req.id,
                status_date: new Date().toISOString().slice(0, 10),
                status_text: row.status_text, anticipation: row.anticipation || '',
                created_at: new Date().toISOString(),
              });
            }
            imported++;
          } catch (e) {
            errors.push(`Row ${i + 1}: ${e}`);
          }
        }

        set({ accounts: newAccounts, requisitions: newReqs, statuses: newStatuses });
        db.replaceAllIndiaStaffing(newAccounts, newReqs, newStatuses);
        return { imported, errors };
      },

      _setFromSupabase: (
        accounts: StaffingAccount[],
        requisitions: StaffingRequisition[],
        statuses: DailyStatus[],
        history?: StaffingHistoryEntry[],
        candidates?: StaffingCandidate[],
      ) =>
        set({
          accounts,
          requisitions,
          statuses,
          ...(history ? { history } : {}),
          ...(candidates ? { candidates } : {}),
        }),
    }),
    {
      name: 'simpliigence-staffing',
      version: 8,
      /** v8 — DO NOT persist `candidates` (or `history`) to localStorage.
       *
       *  We now have ~5000 candidates synced from Zoho Recruit. Persisting
       *  them all serializes to ~5 MB which hits the localStorage quota and
       *  silently truncates the saved state — the UI ends up capped at the
       *  truncated count (~1000) on every subsequent load. Solution: skip
       *  the bulk arrays in persist, refetch from Supabase each load. */
      partialize: (state: StaffingState) => ({
        accounts: state.accounts,
        requisitions: state.requisitions,
        statuses: state.statuses,
        // candidates + history intentionally excluded
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      // NON-DESTRUCTIVE migrate: preserves every existing requisition/status/account;
      // only fills in new fields with safe defaults and bumps 2025 → 2026 on date fields.
      // v7 adds `candidates` field — defaults to [].
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (persisted: any) => {
        if (!persisted) {
          return {
            accounts: SEED_ACCOUNTS,
            requisitions: SEED_REQS,
            statuses: SEED_STATUSES,
            history: [],
            candidates: [],
          };
        }
        const bumpYear = (d: string | undefined | null) =>
          typeof d === 'string' && d.startsWith('2025') ? '2026' + d.slice(4) : d || '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upgradedAccounts = (persisted.accounts || SEED_ACCOUNTS).map((a: any) => ({
          ...a,
          created_at: bumpYear(a.created_at),
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upgradedReqs = (persisted.requisitions || SEED_REQS).map((r: any) => ({
          ...r,
          created_at: bumpYear(r.created_at),
          updated_at: bumpYear(r.updated_at),
          start_date: bumpYear(r.start_date) || (r.created_at ? String(bumpYear(r.created_at)).slice(0, 10) : today()),
          close_by_date: bumpYear(r.close_by_date) || '',
          probability: typeof r.probability === 'number' ? r.probability : 0,
          ai_probability: typeof r.ai_probability === 'number' ? r.ai_probability : 0,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upgradedStatuses = (persisted.statuses || SEED_STATUSES).map((s: any) => ({
          ...s,
          status_date: bumpYear(s.status_date),
          created_at: bumpYear(s.created_at),
        }));
        return {
          accounts: upgradedAccounts,
          requisitions: upgradedReqs,
          statuses: upgradedStatuses,
          history: persisted.history || [],
          candidates: persisted.candidates || [],
        };
      },
    },
  ),
);
