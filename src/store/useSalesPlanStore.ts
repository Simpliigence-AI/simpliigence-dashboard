/**
 * Sales-plan integration store.
 *
 * Reads the 2026 sales plan + signals from the same Supabase project
 * (tables `sales_plan_state` and `sales_plan_signals`, populated by the
 * sales-plan-tool at https://simpliigence-sales-planning-2026.vercel.app/).
 *
 * Exposes `insightForName(name)` keyed on a case-insensitive normalized
 * account name so other pages (India Staffing, etc.) can enrich their
 * own account cards with forecast / secured / unsecured / signal info.
 *
 * The math mirrors `~/sales-plan-tool/lib/model.ts` exactly — see
 * `itemValue()` and `accountTotal()` there.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;
export type PlanMonth = typeof MONTHS[number];

const DEFAULT_HOURS = 160;

type ItemKind = 'onsite' | 'offshore' | 'monthly' | 'fixed' | 'custom';
interface LineItem {
  id: string;
  kind: ItemKind;
  label?: string;
  count?: number;
  rate?: number;
  hours?: number;
  factor?: number;
  amount?: number;
  expr?: string;
  value?: number;
}

interface Locked { value: number; expr?: string }

interface PlanAccount {
  id: string;
  rank: number;
  segment: string;
  account: string;
  salesRep: string;
  months: Record<PlanMonth, LineItem[]>;
  locked: Locked;
}

type SignalKind = 'conversation' | 'opportunity' | 'risk' | 'note';
type SignalSentiment = 'positive' | 'neutral' | 'negative';

export interface PlanSignal {
  id: string;
  accountId?: string;
  accountName: string;
  kind: SignalKind;
  text?: string;
  sentiment?: SignalSentiment;
  amount?: number;
  stage?: string;
  probability?: number;
  closeDate?: string;
  owner?: string;
  createdAt: string;
  archived?: boolean;
  updates?: Array<{ ts: string; text: string }>;
}

export interface AccountInsight {
  /** annual forecast (sum of all months) */
  forecast: number;
  /** locked.value — secured / committed revenue */
  secured: number;
  /** forecast − secured */
  unsecured: number;
  /** 0..1; locked / forecast */
  pctLocked: number;
  monthly: Array<{ month: PlanMonth; value: number }>;
  salesRep?: string;
  segment?: string;
  /** count of non-archived signals */
  signalCount: number;
  openPipeline: number;
  weightedPipeline: number;
  /** ISO ts of most recent signal/update touch */
  lastTouch?: string;
  signals: PlanSignal[];
}

function itemValue(it: LineItem): number {
  const f = it.factor ?? 1;
  switch (it.kind) {
    case 'fixed':
      return it.amount ?? 0;
    case 'monthly':
      return (it.count ?? 0) * (it.rate ?? 0) * f;
    case 'onsite':
    case 'offshore':
      return (it.count ?? 0) * (it.rate ?? 0) * (it.hours ?? DEFAULT_HOURS) * f;
    case 'custom':
      return it.value ?? 0;
    default:
      return 0;
  }
}

function cellTotal(items: LineItem[] | undefined): number {
  if (!items) return 0;
  return items.reduce((s, it) => s + itemValue(it), 0);
}

/** Lower-case + collapse non-alphanumerics — for fuzzy account-name lookup. */
function normName(name: string | undefined | null): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Known account-name aliases. Keys are the variant that appears in the
 * dashboard's own data (India / US staffing); values are the normalized name
 * to look up in the sales plan. Both sides are normalized via `normName`
 * before matching.
 *
 * Add new entries when an account is recorded under different spellings in
 * the dashboard vs the sales plan tool.
 */
const NAME_ALIASES: Record<string, string> = {
  acuity: 'acquity',
  amex: 'american express',
};

interface SalesPlanState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  byName: Record<string, AccountInsight>;
  updatedAt: string | null;
  /** Annual target from the plan, if set. */
  target: number | null;
  load: (opts?: { force?: boolean }) => Promise<void>;
  insightForName: (name: string) => AccountInsight | undefined;
}

export const useSalesPlanStore = create<SalesPlanState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  byName: {},
  updatedAt: null,
  target: null,

  load: async (opts) => {
    const s = get();
    if (s.loading) return;
    if (s.loaded && !opts?.force) return;
    set({ loading: true, error: null });
    try {
      const [planRes, sigRes] = await Promise.all([
        supabase
          .from('sales_plan_state')
          .select('data, updated_at')
          .eq('id', 'default')
          .maybeSingle(),
        supabase
          .from('sales_plan_signals')
          .select('signal'),
      ]);

      const planRow = planRes.data as { data?: { accounts?: PlanAccount[]; target?: number; updatedAt?: string }; updated_at?: string } | null;
      const accounts: PlanAccount[] = planRow?.data?.accounts ?? [];
      const target: number | null = planRow?.data?.target ?? null;

      const rawSignals = (sigRes.data ?? []) as Array<{ signal: PlanSignal }>;
      const signals: PlanSignal[] = rawSignals
        .map((r) => r.signal)
        .filter((sig): sig is PlanSignal => !!sig);

      // Group signals by normalized account name (preferred over accountId
      // because account ids can be missing on free-text signals).
      const sigByName = new Map<string, PlanSignal[]>();
      for (const sig of signals) {
        if (sig.archived) continue;
        const k = normName(sig.accountName);
        if (!k) continue;
        if (!sigByName.has(k)) sigByName.set(k, []);
        sigByName.get(k)!.push(sig);
      }

      const byName: Record<string, AccountInsight> = {};
      // First-word index for prefix matching, e.g. "Ness" (India) → "Ness Technologies" (Plan).
      // Skip if the first word collides across multiple plan accounts so we don't make a wrong pick.
      const firstWordCount = new Map<string, number>();
      for (const a of accounts) {
        const fw = normName(a.account).split(' ')[0];
        if (fw && fw.length >= 4) firstWordCount.set(fw, (firstWordCount.get(fw) ?? 0) + 1);
      }
      for (const a of accounts) {
        const k = normName(a.account);
        if (!k) continue;
        const monthly = MONTHS.map((m) => ({ month: m, value: cellTotal(a.months?.[m]) }));
        const forecast = monthly.reduce((s2, x) => s2 + x.value, 0);
        const secured = a.locked?.value ?? 0;
        const accSignals = sigByName.get(k) ?? [];

        let openPipeline = 0;
        let weighted = 0;
        let lastTouch: string | undefined;
        for (const sig of accSignals) {
          if (sig.kind === 'opportunity') {
            openPipeline += sig.amount ?? 0;
            weighted += (sig.amount ?? 0) * ((sig.probability ?? 0) / 100);
          }
          const lastUpdate = sig.updates && sig.updates.length ? sig.updates[sig.updates.length - 1].ts : null;
          const ts = lastUpdate || sig.createdAt;
          if (ts && (!lastTouch || ts > lastTouch)) lastTouch = ts;
        }

        const insight: AccountInsight = {
          forecast,
          secured,
          unsecured: Math.max(0, forecast - secured),
          pctLocked: forecast > 0 ? secured / forecast : 0,
          monthly,
          salesRep: a.salesRep || undefined,
          segment: a.segment || undefined,
          signalCount: accSignals.length,
          openPipeline,
          weightedPipeline: weighted,
          lastTouch,
          signals: accSignals,
        };
        byName[k] = insight;
        // Alias by unique first word so "Ness" finds "Ness Technologies".
        const fw = k.split(' ')[0];
        if (fw && fw.length >= 4 && firstWordCount.get(fw) === 1 && fw !== k && !byName[fw]) {
          byName[fw] = insight;
        }
      }

      // Explicit alias map: for each (variant → planName), if the plan side
      // is matched, expose the same insight under the variant key too.
      for (const [variant, planName] of Object.entries(NAME_ALIASES)) {
        const variantKey = normName(variant);
        const planKey = normName(planName);
        if (variantKey && planKey && byName[planKey] && !byName[variantKey]) {
          byName[variantKey] = byName[planKey];
        }
      }

      set({
        loaded: true,
        loading: false,
        byName,
        updatedAt: planRow?.data?.updatedAt || planRow?.updated_at || null,
        target,
      });
    } catch (e) {
      console.error('[useSalesPlanStore] load failed', e);
      set({ loading: false, error: (e as Error).message || 'Failed to load sales plan' });
    }
  },

  insightForName: (name) => {
    const key = normName(name);
    const direct = get().byName[key];
    if (direct) return direct;
    const aliased = NAME_ALIASES[key];
    return aliased ? get().byName[normName(aliased)] : undefined;
  },
}));

export { normName as normalizeAccountName };
