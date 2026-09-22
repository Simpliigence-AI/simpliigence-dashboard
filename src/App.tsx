import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { AuthGate } from './components/AuthGate';
import { useForecastStore, useFinancialStore, useSyncStore, useHiringForecastStore, usePipelineStore, useStaffingStore, useUSStaffingStore, useActualHoursStore } from './store';
import { useOpenBenchStore } from './store/useOpenBenchStore';
import { useIndiaRosterStore } from './store/useIndiaRosterStore';
import { useUSRosterStore } from './store/useUSRosterStore';
import { useTaLogStore } from './store/useTaLogStore';
import { useTimeEntryStore } from './store/useTimeEntryStore';
import { useCallsStore } from './store/useCallsStore';
import { useAccountStore } from './store/useAccountStore';
import { usePresalesStore } from './store/usePresalesStore';
import { usePodAssignmentsStore } from './store/usePodAssignmentsStore';
import { useVendorStore } from './store/useVendorStore';
import { useTnmAccountsStore } from './store/useTnmAccountsStore';
import { useAccessStore } from './store/useAccessStore';
import { useConciergeAccountsStore } from './store/useConciergeAccountsStore';
import { useLeaveStore } from './store/useLeaveStore';
import { useFeatureCatalogStore } from './store/useFeatureCatalogStore';
import {
  fetchAssignments,
  fetchFinancialSettings,
  fetchSyncConfig,
  fetchHiringForecastConfig,
  fetchStaffingRequests,
  fetchPipelineProjects,
  fetchIndiaStaffing,
  fetchUSStaffing,
  fetchOpenBench,
  fetchIndiaRoster,
  fetchUSRoster,
  fetchUSRosterAssignments,
  fetchActualHours,
  fetchTaDailyLog,
  fetchTeamMembers,
  fetchPresales,
  fetchTimeEntries,
  fetchCandidateCalls,
  fetchCallTemplates,
  fetchAccountManagement,
  fetchVendors,
  fetchTnmAccounts,
  fetchUserPageAccess,
  fetchConcierge,
  fetchLeaveData,
  fetchPodAssignments,
  setupRealtimeSubscriptions,
  db,
} from './lib/supabaseSync';
import { autoBackupIfNeeded } from './lib/backup';

/**
 * On app start:
 * 1. Try loading data from Supabase (shared database)
 * 2. If Supabase has data → hydrate stores (overrides localStorage)
 * 3. If Supabase is genuinely empty (not timed out) → seed from localStorage/seed data, push to Supabase
 * 4. If Supabase timed out → use localStorage as-is, NEVER overwrite Supabase
 * 5. Set up realtime subscriptions for multi-user sync
 */

/** Wrapper: resolves to { value, timedOut: false } or { value: undefined, timedOut: true } */
async function withTimeout<T>(p: Promise<T>, ms = 10000): Promise<{ value: T; timedOut: false } | { value: undefined; timedOut: true }> {
  return Promise.race([
    p.then((value) => ({ value, timedOut: false as const })),
    new Promise<{ value: undefined; timedOut: true }>((resolve) =>
      setTimeout(() => resolve({ value: undefined, timedOut: true }), ms),
    ),
  ]);
}

function useSupabaseInit() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    async function init() {
      try {
        const [
          forecastRes,
          financialRes,
          syncRes,
          hiringRes,
          staffingRes,
          pipelineRes,
          indiaStaffingRes,
          usStaffingRes,
          openBenchRes,
          indiaRosterRes,
          usRosterRes,
          usRosterAssignmentsRes,
          actualHoursRes,
          taLogRes,
          teamMembersRes,
          timeEntriesRes,
          accountMgmtRes,
          vendorsRes,
          tnmAccountsRes,
          accessRes,
          candidateCallsRes,
          callTemplatesRes,
          presalesRes,
          conciergeRes,
          leaveRes,
          podAssignmentsRes,
        ] = await Promise.all([
          withTimeout(fetchAssignments()),
          withTimeout(fetchFinancialSettings()),
          withTimeout(fetchSyncConfig()),
          withTimeout(fetchHiringForecastConfig()),
          withTimeout(fetchStaffingRequests()),
          withTimeout(fetchPipelineProjects()),
          withTimeout(fetchIndiaStaffing()),
          withTimeout(fetchUSStaffing()),
          withTimeout(fetchOpenBench()),
          withTimeout(fetchIndiaRoster()),
          withTimeout(fetchUSRoster()),
          withTimeout(fetchUSRosterAssignments()),
          withTimeout(fetchActualHours()),
          withTimeout(fetchTaDailyLog()),
          withTimeout(fetchTeamMembers()),
          withTimeout(fetchTimeEntries()),
          withTimeout(fetchAccountManagement()),
          withTimeout(fetchVendors()),
          withTimeout(fetchTnmAccounts()),
          withTimeout(fetchUserPageAccess()),
          withTimeout(fetchCandidateCalls()),
          withTimeout(fetchCallTemplates()),
          withTimeout(fetchPresales()),
          withTimeout(fetchConcierge()),
          withTimeout(fetchLeaveData()),
          withTimeout(fetchPodAssignments()),
        ]);

        // --- Forecast assignments ---
        // Supabase is the source of truth. We no longer auto-seed from localStorage
        // on empty-fetch — that path caused a destructive wipe on 2026-06-09 when
        // an admin's session got an empty response and the old code "helpfully"
        // pushed their stale seed to Supabase, deleting 67+ live requisitions.
        if (!forecastRes.timedOut) {
          const forecastData = forecastRes.value;
          if (forecastData && forecastData.assignments.length > 0) {
            useForecastStore.setState({
              assignments: forecastData.assignments,
              weekDates: forecastData.weekDates,
            });
            console.log('[supabase] Loaded', forecastData.assignments.length, 'assignments from Supabase');
          } else {
            console.warn('[supabase] Forecast assignments empty in Supabase — not auto-seeding (see commit message)');
          }
        } else {
          console.warn('[supabase] Forecast fetch timed out — using localStorage, not overwriting Supabase');
        }

        // --- Financial settings ---
        if (!financialRes.timedOut) {
          if (financialRes.value) {
            useFinancialStore.setState({ settings: financialRes.value });
          } else {
            db.saveFinancialSettings(useFinancialStore.getState().settings);
          }
        }

        // --- Sync config ---
        if (!syncRes.timedOut && syncRes.value) {
          useSyncStore.setState(syncRes.value as unknown as Partial<ReturnType<typeof useSyncStore.getState>>);
        }

        // --- Hiring forecast ---
        if (!hiringRes.timedOut && hiringRes.value) {
          const hd = hiringRes.value;
          if (hd.scenarioSettings?.targetUtilization) {
            useHiringForecastStore.setState({
              conciergeConfig: hd.conciergeConfig,
              scenarioSettings: hd.scenarioSettings,
            });
          } else {
            const s = useHiringForecastStore.getState();
            db.saveHiringConfig(s.conciergeConfig, s.scenarioSettings);
          }
        }

        // --- Staffing requests ---
        if (!staffingRes.timedOut) {
          const sd = staffingRes.value;
          if (sd && sd.length > 0) {
            useHiringForecastStore.setState({ staffingRequests: sd });
          } else {
            const existing = useHiringForecastStore.getState().staffingRequests;
            for (const r of existing) {
              db.insertStaffingRequest(r);
            }
          }
        }

        // --- Pipeline projects ---
        if (!pipelineRes.timedOut) {
          const pd = pipelineRes.value;
          if (pd && pd.length > 0) {
            usePipelineStore.setState({ projects: pd });
          } else {
            console.warn('[supabase] Pipeline projects empty in Supabase — not auto-seeding');
          }
        } else {
          console.warn('[supabase] Pipeline fetch timed out — using localStorage');
        }

        // --- India Staffing ---
        // THIS is the branch that wiped 67 requisitions on 2026-06-09 when an
        // admin's session got an empty fetch response. The destructive
        // db.replaceAllIndiaStaffing call is intentionally gone.
        if (!indiaStaffingRes.timedOut) {
          const id = indiaStaffingRes.value;
          if (id && id.accounts.length > 0) {
            useStaffingStore.setState({
              accounts: id.accounts,
              requisitions: id.requisitions,
              statuses: id.statuses,
              history: id.history || [],
              candidates: id.candidates || [],
            });
            console.log('[supabase] Loaded india staffing:', id.accounts.length, 'accounts,', id.requisitions.length, 'reqs,', (id.history || []).length, 'history entries,', (id.candidates || []).length, 'candidates');
          } else {
            console.warn('[supabase] India staffing empty in Supabase — not auto-seeding');
          }
        } else {
          console.warn('[supabase] India staffing fetch timed out — using localStorage');
        }

        // --- US Staffing ---
        if (!usStaffingRes.timedOut) {
          const ud = usStaffingRes.value;
          if (ud && ud.accounts.length > 0) {
            useUSStaffingStore.setState({
              accounts: ud.accounts,
              requisitions: ud.requisitions,
              contacts: ud.contacts ?? [],
            });
            console.log('[supabase] Loaded US staffing:', ud.accounts.length, 'accounts,', ud.requisitions.length, 'reqs,', (ud.contacts ?? []).length, 'contacts');
          } else {
            console.warn('[supabase] US staffing empty in Supabase — not auto-seeding');
          }
        } else {
          console.warn('[supabase] US staffing fetch timed out — using localStorage');
        }

        // --- Open Bench ---
        if (!openBenchRes.timedOut) {
          const bd = openBenchRes.value;
          if (bd && bd.resources.length > 0) {
            useOpenBenchStore.setState({
              resources: bd.resources,
              updates: bd.updates,
            });
            console.log('[supabase] Loaded open bench:', bd.resources.length, 'resources,', bd.updates.length, 'updates');
          } else {
            console.warn('[supabase] Open bench empty in Supabase — not auto-seeding');
          }
        } else {
          console.warn('[supabase] Open bench fetch timed out — using localStorage');
        }

        // --- India Roster ---
        if (!indiaRosterRes.timedOut) {
          const rd = indiaRosterRes.value;
          if (rd && rd.length > 0) {
            useIndiaRosterStore.setState({ members: rd });
            console.log('[supabase] Loaded india roster:', rd.length, 'members');
          } else {
            console.warn('[supabase] India roster empty in Supabase — not auto-seeding');
          }
        } else {
          console.warn('[supabase] India roster fetch timed out — using localStorage');
        }

        // --- US Roster ---
        if (!usRosterRes.timedOut) {
          const ur = usRosterRes.value;
          if (ur && ur.length > 0) {
            useUSRosterStore.setState({ members: ur });
            console.log('[supabase] Loaded us roster:', ur.length, 'members');
          } else {
            console.warn('[supabase] US roster empty in Supabase — not auto-seeding');
          }
        } else {
          console.warn('[supabase] US roster fetch timed out — using localStorage');
        }

        // --- US Roster Assignments (per-contract SI + end-client + cost/bill) ---
        if (!usRosterAssignmentsRes.timedOut) {
          const ura = usRosterAssignmentsRes.value;
          if (ura) {
            useUSRosterStore.setState({ assignments: ura });
            console.log('[supabase] Loaded us roster assignments:', ura.length);
          }
        } else {
          console.warn('[supabase] US roster assignments fetch timed out');
        }

        // --- Actual Hours (/my-time submissions + frozen Zoho history) ---
        if (!actualHoursRes.timedOut) {
          const ah = actualHoursRes.value;
          if (ah) {
            // Record the fallback either way — a degraded feed that came back
            // empty is exactly the case the vs Forecast tab has to call out.
            useActualHoursStore.setState({ usedLegacyFallback: ah.usedLegacyFallback });
            if (ah.entries.length > 0) {
              useActualHoursStore.setState({ entries: ah.entries });
              console.log('[supabase] Loaded actual hours:', ah.entries.length, 'entries');
            }
          }
        } else {
          console.warn('[supabase] Actual hours fetch timed out — using localStorage');
        }

        // --- TA Daily Log ---
        if (!taLogRes.timedOut) {
          const log = taLogRes.value;
          if (log) {
            useTaLogStore.setState({ entries: log });
            console.log('[supabase] Loaded TA daily log:', log.length, 'entries');
          }
        } else {
          console.warn('[supabase] TA daily log fetch timed out — using localStorage');
        }

        // --- Team Members ---
        if (!teamMembersRes.timedOut) {
          const members = teamMembersRes.value;
          if (members) {
            useTaLogStore.setState({ teamMembers: members });
          }
        }

        // --- Time entries ---
        if (!timeEntriesRes.timedOut) {
          const te = timeEntriesRes.value;
          if (te) {
            useTimeEntryStore.setState({ entries: te });
            console.log('[supabase] Loaded time entries:', te.length);
          }
        } else {
          console.warn('[supabase] Time entries fetch timed out — using localStorage');
        }

        // --- Account Management ---
        if (!accountMgmtRes.timedOut) {
          const data = accountMgmtRes.value;
          if (data) {
            useAccountStore.getState().setAll(data);
            console.log('[supabase] Loaded account mgmt:', data.accounts.length, 'accounts /',
              data.connects.length, 'connects /', data.actions.length, 'actions');
          }
        } else {
          console.warn('[supabase] Account mgmt fetch timed out — using localStorage');
        }

        // --- Presales tracker ---
        if (!presalesRes.timedOut) {
          const data = presalesRes.value;
          if (data) {
            usePresalesStore.getState().hydrate(data.meetings, data.activities);
            console.log('[supabase] Loaded presales:', data.meetings.length, 'meetings /', data.activities.length, 'activities');
          }
        } else {
          console.warn('[supabase] Presales fetch timed out — using localStorage');
        }

        // --- Project Team pod assignments ---
        if (!podAssignmentsRes.timedOut) {
          const data = podAssignmentsRes.value;
          if (data) {
            usePodAssignmentsStore.getState().hydrate(data);
            console.log('[supabase] Loaded pod assignments:', data.length);
          }
        } else {
          console.warn('[supabase] Pod assignments fetch timed out');
        }

        // --- Vendors ---
        if (!vendorsRes.timedOut) {
          const data = vendorsRes.value;
          if (data) {
            useVendorStore.getState().setAll(data);
            console.log('[supabase] Loaded vendors:', data.vendors.length, 'vendors /',
              data.outreach.length, 'outreaches');
          }
        } else {
          console.warn('[supabase] Vendors fetch timed out — using localStorage');
        }

        // --- TNM Accounts ---
        if (!tnmAccountsRes.timedOut) {
          const data = tnmAccountsRes.value;
          if (data) {
            useTnmAccountsStore.getState().setAll(data);
            console.log('[supabase] Loaded tnm accounts:', data.accounts.length, 'accounts /',
              data.contacts.length, 'contacts');
          }
        } else {
          console.warn('[supabase] TNM accounts fetch timed out — using localStorage');
        }

        // --- Access matrix ---
        if (!accessRes.timedOut) {
          const rows = accessRes.value;
          if (rows) {
            useAccessStore.getState().hydrate(rows);
            console.log('[supabase] Loaded user_page_access:', rows.length, 'grants');
          }
        } else {
          console.warn('[supabase] user_page_access fetch timed out — using localStorage');
        }

        // --- Concierge accounts (managed-services 360 view) ---
        if (!conciergeRes.timedOut) {
          const data = conciergeRes.value;
          if (data) {
            useConciergeAccountsStore.getState().hydrate(data.accounts, data.features, data.billing);
            console.log('[supabase] Loaded concierge:', data.accounts.length, 'accounts /',
              data.features.length, 'features /', data.billing.length, 'billing entries');
          }
        } else {
          console.warn('[supabase] Concierge fetch timed out — using localStorage');
        }

        // --- Leave management (types + requests + allocations) ---
        if (!leaveRes.timedOut) {
          const data = leaveRes.value;
          if (data) {
            useLeaveStore.getState().hydrate(data.types, data.requests, data.allocations);
            console.log('[supabase] Loaded leave:',
              data.types.length, 'types /',
              data.requests.length, 'requests /',
              data.allocations.length, 'allocations');
          }
        } else {
          console.warn('[supabase] Leave fetch timed out — using localStorage');
        }

        // --- Feature catalog (used by Concierge scorecard + backlog + catalog tab) ---
        void useFeatureCatalogStore.getState().load();

        // --- Candidate AI calls + templates ---
        if (!candidateCallsRes.timedOut) {
          const rows = candidateCallsRes.value;
          if (rows) {
            useCallsStore.setState({ calls: rows });
            console.log('[supabase] Loaded candidate calls:', rows.length);
          }
        }
        if (!callTemplatesRes.timedOut) {
          const rows = callTemplatesRes.value;
          if (rows) useCallsStore.setState({ templates: rows });
        }

        // Set up realtime subscriptions
        cleanup = setupRealtimeSubscriptions({
          setForecastState: (assignments, weekDates) => {
            const update: Record<string, unknown> = { assignments };
            if (weekDates !== undefined) update.weekDates = weekDates;
            useForecastStore.setState(update as { assignments: typeof assignments; weekDates?: string[] });
          },
          setFinancialSettings: (settings) => {
            useFinancialStore.setState({ settings });
          },
          setSyncConfig: (config) => {
            useSyncStore.setState(config as unknown as Partial<ReturnType<typeof useSyncStore.getState>>);
          },
          setHiringConfig: (concierge, scenario, requests) => {
            useHiringForecastStore.setState({
              conciergeConfig: concierge,
              scenarioSettings: scenario,
              staffingRequests: requests,
            });
          },
          setPipelineProjects: (projects) => {
            usePipelineStore.setState({ projects });
          },
          setIndiaStaffing: (accounts, requisitions, statuses, history, candidates) => {
            useStaffingStore.setState({
              accounts,
              requisitions,
              statuses,
              ...(history ? { history } : {}),
              ...(candidates ? { candidates } : {}),
            });
          },
          setUSStaffing: (accounts, requisitions, contacts) => {
            useUSStaffingStore.setState({
              accounts,
              requisitions,
              ...(contacts !== undefined ? { contacts } : {}),
            });
          },
          setOpenBench: (resources, updates) => {
            useOpenBenchStore.setState({ resources, updates });
          },
          setIndiaRoster: (members) => {
            useIndiaRosterStore.setState({ members });
          },
          setTaDailyLog: (entries) => {
            useTaLogStore.setState({ entries });
          },
          setTeamMembers: (members) => {
            useTaLogStore.setState({ teamMembers: members });
          },
          setTimeEntries: (entries) => {
            useTimeEntryStore.setState({ entries });
          },
          setActualHours: (feed) => {
            useActualHoursStore.setState({
              entries: feed.entries,
              usedLegacyFallback: feed.usedLegacyFallback,
            });
          },
          setAccountManagement: (data) => {
            useAccountStore.getState().setAll(data);
          },
          setVendors: (data) => {
            useVendorStore.getState().setAll(data);
          },
          setCandidateCalls: (rows) => {
            useCallsStore.setState({ calls: rows });
          },
          setCallTemplates: (rows) => {
            useCallsStore.setState({ templates: rows });
          },
          setUSRoster: (members) => {
            useUSRosterStore.setState({ members });
          },
          setUSRosterAssignments: (assignments) => {
            useUSRosterStore.setState({ assignments });
          },
          getForecastAssignments: () => useForecastStore.getState().assignments,
          getStaffingRequests: () => useHiringForecastStore.getState().staffingRequests,
          getPipelineProjects: () => usePipelineStore.getState().projects,
        });

        console.log('[supabase] Initialized — data loaded and realtime subscriptions active');

        // Run daily auto-backup after successful init
        autoBackupIfNeeded().catch(() => {});
      } catch (err) {
        console.warn('[supabase] Init failed, using local data:', err);
      } finally {
        setReady(true);
      }
    }

    init();
    return () => { cleanup?.(); };
  }, []);

  return ready;
}

/** Inner app — only mounts AFTER the user is authenticated, so all Supabase
 *  reads run as the signed-in user (RLS sees a real auth.uid()). */
function AuthenticatedApp() {
  const ready = useSupabaseInit();

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-2/70">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return <RouterProvider router={router} />;
}

function App() {
  return (
    <AuthGate>
      <AuthenticatedApp />
    </AuthGate>
  );
}

export default App;
