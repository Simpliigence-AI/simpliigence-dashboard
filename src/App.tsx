import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { nanoid } from 'nanoid';
import { AuthGate } from './components/AuthGate';
import { buildSeedAssignments } from './data/employeeSeed';
import { useForecastStore, useFinancialStore, useSyncStore, useHiringForecastStore, usePipelineStore, useStaffingStore, useUSStaffingStore, useActualHoursStore } from './store';
import { useOpenBenchStore } from './store/useOpenBenchStore';
import { useIndiaRosterStore } from './store/useIndiaRosterStore';
import { useUSRosterStore } from './store/useUSRosterStore';
import { useTaLogStore } from './store/useTaLogStore';
import { useTimeEntryStore } from './store/useTimeEntryStore';
import { ZOHO_SEED_PROJECTS } from './data/zohoSeed';
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
  fetchActualHours,
  fetchTaDailyLog,
  fetchTeamMembers,
  fetchTimeEntries,
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
          actualHoursRes,
          taLogRes,
          teamMembersRes,
          timeEntriesRes,
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
          withTimeout(fetchActualHours()),
          withTimeout(fetchTaDailyLog()),
          withTimeout(fetchTeamMembers()),
          withTimeout(fetchTimeEntries()),
        ]);

        // --- Forecast assignments ---
        if (!forecastRes.timedOut) {
          const forecastData = forecastRes.value;
          if (forecastData && forecastData.assignments.length > 0) {
            useForecastStore.setState({
              assignments: forecastData.assignments,
              weekDates: forecastData.weekDates,
            });
            console.log('[supabase] Loaded', forecastData.assignments.length, 'assignments from Supabase');
          } else {
            // Supabase is genuinely empty — seed
            console.log('[supabase] Supabase is empty — seeding...');
            const localAssignments = useForecastStore.getState().assignments;
            if (localAssignments.length > 0) {
              const withIds = localAssignments.map((a) => (a.id ? a : { ...a, id: nanoid() }));
              useForecastStore.setState({ assignments: withIds });
              await db.replaceAllAssignments(withIds, useForecastStore.getState().weekDates);
            } else {
              const seedAssignments = buildSeedAssignments();
              useForecastStore.setState({ assignments: seedAssignments, weekDates: [] });
              await db.replaceAllAssignments(seedAssignments, []);
            }
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
            const localProjects = usePipelineStore.getState().projects;
            if (localProjects.length === 0) {
              usePipelineStore.setState({ projects: ZOHO_SEED_PROJECTS });
              await db.replacePipelineProjects(ZOHO_SEED_PROJECTS);
            } else {
              await db.replacePipelineProjects(localProjects);
            }
          }
        } else {
          console.warn('[supabase] Pipeline fetch timed out — using localStorage');
        }

        // --- India Staffing ---
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
            // Supabase empty — push local/seed data
            const local = useStaffingStore.getState();
            if (local.accounts.length > 0) {
              await db.replaceAllIndiaStaffing(local.accounts, local.requisitions, local.statuses);
              console.log('[supabase] Seeded india staffing to Supabase');
            }
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
            });
            console.log('[supabase] Loaded US staffing:', ud.accounts.length, 'accounts,', ud.requisitions.length, 'reqs');
          } else {
            const local = useUSStaffingStore.getState();
            if (local.accounts.length > 0) {
              await db.replaceAllUSStaffing(local.accounts, local.requisitions);
              console.log('[supabase] Seeded US staffing to Supabase');
            }
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
            const local = useOpenBenchStore.getState();
            if (local.resources.length > 0) {
              await db.replaceAllOpenBench(local.resources, local.updates);
              console.log('[supabase] Seeded open bench to Supabase');
            }
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
            const local = useIndiaRosterStore.getState();
            if (local.members.length > 0) {
              await db.replaceAllIndiaRoster(local.members);
              console.log('[supabase] Seeded india roster to Supabase');
            }
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
            const local = useUSRosterStore.getState();
            if (local.members.length > 0) {
              await db.replaceAllUSRoster(local.members);
              console.log('[supabase] Seeded us roster to Supabase');
            }
          }
        } else {
          console.warn('[supabase] US roster fetch timed out — using localStorage');
        }

        // --- Actual Hours (Zoho People timesheets) ---
        if (!actualHoursRes.timedOut) {
          const ah = actualHoursRes.value;
          if (ah && ah.length > 0) {
            useActualHoursStore.setState({ entries: ah });
            console.log('[supabase] Loaded actual hours:', ah.length, 'entries');
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
          setUSStaffing: (accounts, requisitions) => {
            useUSStaffingStore.setState({ accounts, requisitions });
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
          setUSRoster: (members) => {
            useUSRosterStore.setState({ members });
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
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading dashboard...</p>
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
