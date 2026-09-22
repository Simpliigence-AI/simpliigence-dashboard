/**
 * Check-ins store.
 *
 * Unlike the older stores this one talks to Supabase directly rather than
 * going through supabaseSync — the data is small and always scoped to one
 * person and one month, so there is nothing to hydrate app-wide.
 *
 * The database is the authority on what a lock stops. Every mutation here
 * simply surfaces whatever the trigger says, so a blocked edit shows the
 * real reason ("This month is locked - only a check-in owner can change the
 * forecast") instead of a generic failure.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type {
  CheckinFunction, CheckinKpi, CheckinMember, CheckinScope, CheckinUpdate,
  CheckinAuditRow, ScorecardRow, ScorecardKpi, CheckinTemplateRow,
} from '../types/checkin';

/** YYYY-MM for a Date. */
export function toPeriod(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "August 2026" for a YYYY-MM. */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Step a YYYY-MM by n months. */
export function shiftPeriod(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  return toPeriod(new Date(y, m - 1 + n, 1));
}

interface CheckinState {
  // config
  functions: CheckinFunction[];
  scopes: CheckinScope[];
  members: CheckinMember[];
  kpis: CheckinKpi[];
  matrix: ScorecardKpi[];
  templates: CheckinTemplateRow[];
  isOwner: boolean;

  // current card
  rows: ScorecardRow[];
  feed: CheckinUpdate[];
  audit: CheckinAuditRow[];

  loadingConfig: boolean;
  loadingCard: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  loadCard: (period: string, ownerEmail: string) => Promise<void>;

  setTarget: (targetId: string, value: number) => Promise<string | null>;
  setActual: (targetId: string, value: number | null, note?: string) => Promise<string | null>;
  setLock: (checkinId: string, locked: boolean) => Promise<string | null>;
  setFocus: (checkinId: string, focus: string) => Promise<string | null>;
  addUpdate: (checkinId: string, kpiKey: string | null, note: string, delta: number | null) => Promise<string | null>;

  // admin
  addMember: (email: string, name: string, functionKey: string, scopeKey: string) => Promise<string | null>;
  setMemberActive: (email: string, active: boolean) => Promise<string | null>;
  setMemberScope: (email: string, scopeKey: string) => Promise<string | null>;
  addKpi: (p: { kpiKey: string; label: string; functionKey: string; description?: string;
                actualSource?: 'auto' | 'manual'; unit?: string; direction?: string }) => Promise<string | null>;
  toggleMatrix: (ownerEmail: string, kpiKey: string, active: boolean) => Promise<string | null>;
  clearError: () => void;
}

/** Turn a PostgREST error into the message the trigger actually raised. */
function msg(e: { message?: string } | null): string | null {
  if (!e) return null;
  return e.message ?? 'Something went wrong';
}

export const useCheckinStore = create<CheckinState>()((set, get) => ({
  functions: [], scopes: [], members: [], kpis: [], matrix: [], templates: [],
  isOwner: false,
  rows: [], feed: [], audit: [],
  loadingConfig: false, loadingCard: false, error: null,

  clearError: () => set({ error: null }),

  loadConfig: async () => {
    set({ loadingConfig: true, error: null });
    const [fns, scopes, members, kpis, matrix, templates, owner] = await Promise.all([
      supabase.from('checkin_functions').select('*').eq('active', true).order('sort_order'),
      supabase.from('checkin_scopes').select('*').order('scope_key'),
      supabase.from('checkin_members').select('*').order('sort_order'),
      supabase.from('checkin_kpis').select('*').order('sort_order'),
      supabase.from('checkin_scorecard_kpis').select('*').order('sort_order'),
      supabase.from('checkin_templates').select('*').order('sort_order'),
      supabase.rpc('is_checkin_owner'),
    ]);

    set({
      functions: (fns.data ?? []).map((r: Record<string, unknown>) => ({
        functionKey: r.function_key as string, label: r.label as string,
        description: (r.description ?? null) as string | null,
        sortOrder: r.sort_order as number, active: r.active as boolean,
      })),
      scopes: (scopes.data ?? []).map((r: Record<string, unknown>) => ({
        scopeKey: r.scope_key as string, label: r.label as string,
        kind: r.kind as CheckinScope['kind'], value: (r.value ?? null) as string | null,
      })),
      members: (members.data ?? []).map((r: Record<string, unknown>) => ({
        email: r.email as string, displayName: r.display_name as string,
        functionKey: r.function_key as string, scopeKey: r.scope_key as string,
        active: r.active as boolean, sortOrder: r.sort_order as number,
        notes: (r.notes ?? null) as string | null,
      })),
      kpis: (kpis.data ?? []).map((r: Record<string, unknown>) => ({
        kpiKey: r.kpi_key as string, label: r.label as string,
        description: (r.description ?? null) as string | null,
        actualSource: r.actual_source as CheckinKpi['actualSource'],
        metricKey: (r.metric_key ?? null) as string | null,
        poolMetric: (r.pool_metric ?? null) as string | null,
        unit: r.unit as CheckinKpi['unit'], direction: r.direction as CheckinKpi['direction'],
        functionKey: (r.function_key ?? null) as string | null,
        sortOrder: r.sort_order as number, active: r.active as boolean,
      })),
      matrix: (matrix.data ?? []).map((r: Record<string, unknown>) => ({
        ownerEmail: r.owner_email as string, kpiKey: r.kpi_key as string,
        customLabel: (r.custom_label ?? null) as string | null,
        sortOrder: r.sort_order as number, active: r.active as boolean,
      })),
      templates: (templates.data ?? []).map((r: Record<string, unknown>) => ({
        functionKey: r.function_key as string, kpiKey: r.kpi_key as string,
        defaultTarget: (r.default_target ?? null) as number | null,
        sortOrder: r.sort_order as number, active: r.active as boolean,
      })),
      isOwner: owner.data === true,
      loadingConfig: false,
    });
  },

  loadCard: async (period, ownerEmail) => {
    set({ loadingCard: true, error: null });

    // Creates the card and seeds a target row per KPI if it isn't there yet.
    const opened = await supabase.rpc('checkin_open', {
      p_period: period, p_owner_email: ownerEmail,
    });
    if (opened.error) {
      set({ loadingCard: false, error: msg(opened.error), rows: [], feed: [], audit: [] });
      return;
    }
    const checkinId = opened.data as string;

    const [rows, feed, audit] = await Promise.all([
      supabase.from('v_checkin_scorecard').select('*')
        .eq('period', period).eq('owner_email', ownerEmail).order('sort_order'),
      supabase.from('checkin_updates').select('*')
        .eq('checkin_id', checkinId).order('update_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase.from('v_checkin_audit').select('*')
        .eq('period', period).limit(100),
    ]);

    set({
      rows: (rows.data ?? []).map((r: Record<string, unknown>) => ({
        checkinId: r.checkin_id as string, period: r.period as string,
        ownerEmail: r.owner_email as string, displayName: r.display_name as string,
        functionKey: r.function_key as string, functionLabel: r.function_label as string,
        scopeKey: r.scope_key as string, scopeLabel: r.scope_label as string,
        focus: (r.focus ?? null) as string | null, locked: r.locked as boolean,
        lockedAt: (r.locked_at ?? null) as string | null,
        lockedBy: (r.locked_by ?? null) as string | null,
        kpiKey: r.kpi_key as string, label: r.label as string,
        description: (r.description ?? null) as string | null,
        actualSource: r.actual_source as ScorecardRow['actualSource'],
        unit: r.unit as ScorecardRow['unit'],
        direction: r.direction as ScorecardRow['direction'],
        sortOrder: r.sort_order as number,
        targetId: (r.target_id ?? null) as string | null,
        targetValue: Number(r.target_value ?? 0),
        autoActual: r.auto_actual === null || r.auto_actual === undefined ? null : Number(r.auto_actual),
        manualActual: r.manual_actual === null || r.manual_actual === undefined ? null : Number(r.manual_actual),
        manualActualNote: (r.manual_actual_note ?? null) as string | null,
        manualActualBy: (r.manual_actual_by ?? null) as string | null,
        manualActualAt: (r.manual_actual_at ?? null) as string | null,
        targetSetBy: (r.target_set_by ?? null) as string | null,
        feedDelta: r.feed_delta === null || r.feed_delta === undefined ? null : Number(r.feed_delta),
        updateCount: Number(r.update_count ?? 0),
        lastUpdateAt: (r.last_update_at ?? null) as string | null,
        actualValue: Number(r.actual_value ?? 0),
        poolValue: r.pool_value === null || r.pool_value === undefined ? null : Number(r.pool_value),
        isOverridden: r.is_overridden === true,
        auditCount: Number(r.audit_count ?? 0),
        variance: Number(r.variance ?? 0),
        attainmentPct: r.attainment_pct === null || r.attainment_pct === undefined ? null : Number(r.attainment_pct),
      })),
      feed: (feed.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, checkinId: r.checkin_id as string,
        kpiKey: (r.kpi_key ?? null) as string | null,
        updateDate: r.update_date as string, note: r.note as string,
        delta: r.delta === null || r.delta === undefined ? null : Number(r.delta),
        refType: (r.ref_type ?? null) as string | null,
        refId: (r.ref_id ?? null) as string | null,
        authorEmail: r.author_email as string, createdAt: r.created_at as string,
        editedAt: (r.edited_at ?? null) as string | null,
      })),
      audit: (audit.data ?? [])
        .filter((r: Record<string, unknown>) => (r.owner_name ?? '') !== '' || true)
        .map((r: Record<string, unknown>) => ({
          id: r.id as number, changedAt: r.changed_at as string,
          changedBy: r.changed_by as string, changedByName: r.changed_by_name as string,
          ownerName: (r.owner_name ?? null) as string | null,
          period: (r.period ?? null) as string | null,
          kpiKey: (r.kpi_key ?? null) as string | null,
          kpiLabel: (r.kpi_label ?? null) as string | null,
          field: r.field as string,
          oldValue: (r.old_value ?? null) as string | null,
          newValue: (r.new_value ?? null) as string | null,
          action: r.action as CheckinAuditRow['action'],
        })),
      loadingCard: false,
    });
  },

  setTarget: async (targetId, value) => {
    const { error } = await supabase.from('checkin_targets')
      .update({ target_value: value }).eq('id', targetId);
    if (error) { set({ error: msg(error) }); return msg(error); }
    return null;
  },

  setActual: async (targetId, value, note) => {
    const patch: Record<string, unknown> = { manual_actual: value };
    if (note !== undefined) patch.manual_actual_note = note;
    const { error } = await supabase.from('checkin_targets').update(patch).eq('id', targetId);
    if (error) { set({ error: msg(error) }); return msg(error); }
    return null;
  },

  setLock: async (checkinId, locked) => {
    const { error } = await supabase.from('checkins').update({ locked }).eq('id', checkinId);
    if (error) { set({ error: msg(error) }); return msg(error); }
    return null;
  },

  setFocus: async (checkinId, focus) => {
    const { error } = await supabase.from('checkins').update({ focus }).eq('id', checkinId);
    if (error) { set({ error: msg(error) }); return msg(error); }
    return null;
  },

  addUpdate: async (checkinId, kpiKey, note, delta) => {
    const { error } = await supabase.from('checkin_updates').insert({
      checkin_id: checkinId, kpi_key: kpiKey, note, delta,
    });
    if (error) { set({ error: msg(error) }); return msg(error); }
    return null;
  },

  addMember: async (email, name, functionKey, scopeKey) => {
    const { error } = await supabase.rpc('checkin_add_member', {
      p_email: email, p_display_name: name, p_function_key: functionKey, p_scope_key: scopeKey,
    });
    if (error) { set({ error: msg(error) }); return msg(error); }
    await get().loadConfig();
    return null;
  },

  setMemberActive: async (email, active) => {
    const { error } = await supabase.from('checkin_members').update({ active }).eq('email', email);
    if (error) { set({ error: msg(error) }); return msg(error); }
    await get().loadConfig();
    return null;
  },

  setMemberScope: async (email, scopeKey) => {
    const { error } = await supabase.from('checkin_members').update({ scope_key: scopeKey }).eq('email', email);
    if (error) { set({ error: msg(error) }); return msg(error); }
    await get().loadConfig();
    return null;
  },

  addKpi: async (p) => {
    const { error } = await supabase.rpc('checkin_add_kpi', {
      p_kpi_key: p.kpiKey, p_label: p.label, p_function_key: p.functionKey,
      p_description: p.description ?? null,
      p_actual_source: p.actualSource ?? 'manual',
      p_metric_key: null,
      p_unit: p.unit ?? 'count',
      p_direction: p.direction ?? 'higher',
      p_apply_to_existing: true,
    });
    if (error) { set({ error: msg(error) }); return msg(error); }
    await get().loadConfig();
    return null;
  },

  toggleMatrix: async (ownerEmail, kpiKey, active) => {
    const existing = get().matrix.find((m) => m.ownerEmail === ownerEmail && m.kpiKey === kpiKey);
    const { error } = existing
      ? await supabase.from('checkin_scorecard_kpis').update({ active })
          .eq('owner_email', ownerEmail).eq('kpi_key', kpiKey)
      : await supabase.from('checkin_scorecard_kpis')
          .insert({ owner_email: ownerEmail, kpi_key: kpiKey, active });
    if (error) { set({ error: msg(error) }); return msg(error); }
    await get().loadConfig();
    return null;
  },
}));
