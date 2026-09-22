/**
 * Check-ins — one scorecard per person per month, per corporate function.
 *
 * Flip the function, flip the month, flip the person. The forecast column is
 * frozen once the owner locks the month; actuals and the rolling feed stay
 * open all month, because that is the point of a rolling check-in.
 *
 * Nothing here enforces the rules — the database does, via triggers. This
 * page just shows what it is told and surfaces the real error text when a
 * write is refused.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Lock, Unlock, MessageSquarePlus, History,
  Info, AlertCircle, Plus, X,
} from 'lucide-react';
import {
  useCheckinStore, periodLabel, shiftPeriod, toPeriod,
} from '../store/useCheckinStore';
import type { ScorecardRow } from '../types/checkin';

function fmt(v: number | null, unit: string): string {
  if (v === null || v === undefined) return '—';
  if (unit === 'percent') return `${v}%`;
  if (unit === 'hours') return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return v.toLocaleString();
}

/** Attainment band. For a 'lower is better' KPI the scale inverts. */
function band(pct: number | null): 'good' | 'warn' | 'bad' | 'none' {
  if (pct === null) return 'none';
  if (pct >= 100) return 'good';
  if (pct >= 70) return 'warn';
  return 'bad';
}

const BAND_BAR: Record<string, string> = {
  good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', none: 'bg-line',
};
const BAND_TEXT: Record<string, string> = {
  good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-red-600', none: 'text-muted',
};

export default function CheckinsPage() {
  const {
    functions, members, rows, feed, audit, isOwner,
    loadingConfig, loadingCard, error, clearError,
    loadConfig, loadCard, setTarget, setActual, setLock, setFocus, addUpdate,
  } = useCheckinStore();

  const [functionKey, setFunctionKey] = useState<string>('sales');
  const [period, setPeriod] = useState<string>(() => toPeriod(new Date()));
  const [emailPref, setEmailPref] = useState<string>('');
  const [panel, setPanel] = useState<'how' | 'audit'>('how');
  const [selected, setSelected] = useState<string | null>(null);
  const [composerFor, setComposerFor] = useState<string | null>(null);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const roster = useMemo(
    () => members.filter((m) => m.functionKey === functionKey && m.active),
    [members, functionKey],
  );

  // The selected person is derived, not stored: flipping function or
  // deactivating someone falls back to the first name on the roster without
  // a round trip through state.
  const email = roster.some((m) => m.email === emailPref)
    ? emailPref
    : (roster[0]?.email ?? '');

  useEffect(() => {
    if (email) void loadCard(period, email);
  }, [period, email, loadCard]);

  const card = rows[0];
  const locked = card?.locked ?? false;
  const canEditForecast = isOwner || !locked;

  async function refresh() { if (email) await loadCard(period, email); }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Check-ins</h1>
          <p className="text-[13px] text-muted mt-0.5 max-w-[62ch]">
            One scorecard per person per month. Forecasts are set and locked by the owner;
            actuals, comments and overrides stay open — and every change is on the record.
          </p>
        </div>
        {isOwner && (
          <span className="text-[11px] px-2 py-1 rounded-md bg-surface-2 border border-line text-muted">
            You own the forecast
          </span>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="p-0.5 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {/* Function strip */}
      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {functions.map((f) => {
          const n = members.filter((m) => m.functionKey === f.functionKey && m.active).length;
          const on = f.functionKey === functionKey;
          return (
            <button
              key={f.functionKey}
              onClick={() => { setFunctionKey(f.functionKey); setSelected(null); }}
              className={`px-3.5 py-2 text-[13.5px] whitespace-nowrap border-b-2 transition ${
                on ? 'border-primary text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {f.label.replace(/ Check-in$/, '')}
              <span className="ml-1.5 text-[10.5px] text-muted">{n || '—'}</span>
            </button>
          );
        })}
      </div>

      {loadingConfig && <p className="text-[13px] text-muted">Loading…</p>}

      {!loadingConfig && !roster.length && (
        <div className="rounded-xl border border-line bg-surface p-8 text-center">
          <h3 className="text-sm font-bold text-ink mb-1.5">
            Nobody on this check-in yet
          </h3>
          <p className="text-[13px] text-muted max-w-[46ch] mx-auto mb-3">
            Add a person and they inherit this function&rsquo;s KPI template. Nothing to
            configure per-person unless you want to.
          </p>
          {isOwner && (
            <a href="./admin/checkins" className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-[13px] font-semibold">
              <Plus size={14} /> Open the check-in admin
            </a>
          )}
        </div>
      )}

      {!!roster.length && (
        <>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
            <div className="flex items-center rounded-lg border border-line bg-surface-2">
              <button onClick={() => setPeriod(shiftPeriod(period, -1))} className="px-2.5 py-1.5 text-muted hover:text-primary" aria-label="Previous month">
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[132px] text-center text-[13.5px] font-semibold">{periodLabel(period)}</span>
              <button onClick={() => setPeriod(shiftPeriod(period, 1))} className="px-2.5 py-1.5 text-muted hover:text-primary" aria-label="Next month">
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {roster.map((m) => (
                <button
                  key={m.email}
                  onClick={() => { setEmailPref(m.email); setSelected(null); }}
                  className={`px-3 py-1.5 rounded-full text-[12.5px] border transition ${
                    m.email === email
                      ? 'bg-ink text-surface border-ink font-medium'
                      : 'bg-surface-2 text-muted border-line hover:text-ink'
                  }`}
                >
                  {m.displayName}
                </button>
              ))}
            </div>

            <span className="flex-1" />

            {card && (
              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium border ${
                locked ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {locked ? <Lock size={12} /> : <Unlock size={12} />}
                {locked ? 'Forecast locked' : 'Forecast open'}
                {isOwner && (
                  <button
                    onClick={async () => { await setLock(card.checkinId, !locked); await refresh(); }}
                    className="underline underline-offset-2 opacity-80 hover:opacity-100"
                  >
                    {locked ? 'Unlock' : 'Lock it'}
                  </button>
                )}
              </span>
            )}
          </div>

          {/* Focus */}
          {card && (
            <div className="flex items-baseline gap-3 rounded-r-lg border border-l-[3px] border-line border-l-primary bg-surface px-4 py-2.5">
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-muted flex-shrink-0">Focus</span>
              {isOwner ? (
                <input
                  defaultValue={card.focus ?? ''}
                  placeholder="What this person is pointed at this month"
                  onBlur={async (e) => {
                    if (e.target.value !== (card.focus ?? '')) {
                      await setFocus(card.checkinId, e.target.value); await refresh();
                    }
                  }}
                  className="flex-1 bg-transparent text-[13.5px] focus:outline-none placeholder:text-muted/60 placeholder:italic"
                />
              ) : (
                <p className="text-[13.5px] m-0">
                  {card.focus || <span className="text-muted italic">Not set for this month.</span>}
                </p>
              )}
            </div>
          )}

          {/* Scorecard */}
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line/60">
              <h2 className="text-sm font-bold text-ink">
                {card ? `${card.displayName} · ${periodLabel(period)}` : periodLabel(period)}
              </h2>
              {card && (
                <span className="text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  {card.scopeKey === 'none'
                    ? 'No data scope — entered by hand'
                    : `Auto KPIs read the ${card.scopeLabel} slice`}
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.09em] text-muted">
                    <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">KPI</th>
                    <th className="text-right font-normal px-4 py-2.5 border-b border-line/60">Forecast</th>
                    <th className="text-right font-normal px-4 py-2.5 border-b border-line/60">Actual</th>
                    <th className="text-right font-normal px-4 py-2.5 border-b border-line/60">Var</th>
                    <th className="text-right font-normal px-4 py-2.5 border-b border-line/60">Attainment</th>
                    <th className="text-right font-normal px-4 py-2.5 border-b border-line/60">Source</th>
                    <th className="text-right font-normal px-4 py-2.5 border-b border-line/60"></th>
                  </tr>
                </thead>
                <tbody>
                  {loadingCard && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-[13px] text-muted">Loading…</td></tr>
                  )}
                  {!loadingCard && rows.map((r) => (
                    <Row
                      key={r.kpiKey}
                      r={r}
                      selected={selected === r.kpiKey}
                      canEditForecast={canEditForecast}
                      onSelect={() => { setSelected(r.kpiKey); setPanel('how'); }}
                      onTarget={async (v) => { await setTarget(r.targetId!, v); await refresh(); }}
                      onActual={async (v) => { await setActual(r.targetId!, v); await refresh(); }}
                      onComment={() => setComposerFor(r.kpiKey)}
                    />
                  ))}
                  {!loadingCard && !rows.length && (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-[13px] text-muted">
                      No KPIs on this card yet.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Feed + side panel */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-4 items-start">
            <div className="rounded-xl border border-line bg-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
                <h2 className="text-sm font-bold text-ink">Rolling feed</h2>
                <span className="text-[10.5px] uppercase tracking-[0.09em] text-muted">
                  {feed.length ? `${feed.length} update${feed.length === 1 ? '' : 's'}` : 'nothing yet'}
                </span>
              </div>

              {card && (
                <Composer
                  key={composerFor ?? 'general'}
                  kpiKey={composerFor}
                  rows={rows}
                  onCancel={() => setComposerFor(null)}
                  onPost={async (kpiKey, note, delta) => {
                    await addUpdate(card.checkinId, kpiKey, note, delta);
                    setComposerFor(null);
                    await refresh();
                  }}
                />
              )}

              <ul className="m-0 p-0 list-none">
                {feed.map((u) => {
                  const kpi = rows.find((r) => r.kpiKey === u.kpiKey);
                  return (
                    <li key={u.id} className="flex gap-3 px-4 py-3 border-b border-line/40 last:border-b-0">
                      <span className="w-[52px] flex-shrink-0 text-[11px] text-muted pt-0.5">
                        {new Date(u.updateDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-[11.5px] font-medium text-muted">{u.authorEmail.split('@')[0]}</span>
                          {kpi && (
                            <span className="text-[9.5px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded bg-surface-2 border border-line/60 text-ink/70">
                              {kpi.label}
                            </span>
                          )}
                          {u.delta !== null && (
                            <span className="text-[11px] font-medium text-emerald-600">
                              {u.delta > 0 ? `+${u.delta}` : u.delta}
                            </span>
                          )}
                          {u.editedAt && <span className="text-[10px] text-muted italic">edited</span>}
                        </span>
                        <p className="text-[13px] m-0 text-ink/90">{u.note}</p>
                      </span>
                    </li>
                  );
                })}
                {!feed.length && (
                  <li className="px-4 py-5 text-[13px] text-muted">No check-in entries for this month yet.</li>
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-line bg-surface overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
                <h2 className="text-sm font-bold text-ink">
                  {panel === 'audit' ? 'Audit trail' : 'How it works'}
                </h2>
                <span className="flex gap-3">
                  <PanelTab on={panel === 'how'} onClick={() => setPanel('how')} icon={Info} label="Detail" />
                  <PanelTab on={panel === 'audit'} onClick={() => setPanel('audit')} icon={History} label="Audit" />
                </span>
              </div>

              {panel === 'audit'
                ? <AuditPanel audit={audit} />
                : <HowPanel row={rows.find((r) => r.kpiKey === selected) ?? null} rowCount={rows.length} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PanelTab({ on, onClick, icon: Icon, label }: {
  on: boolean; onClick: () => void; icon: typeof Info; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[12px] pb-1 border-b-2 transition ${
        on ? 'border-primary text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      <Icon size={12} /> {label}
    </button>
  );
}

function Row({ r, selected, canEditForecast, onSelect, onTarget, onActual, onComment }: {
  r: ScorecardRow;
  selected: boolean;
  canEditForecast: boolean;
  onSelect: () => void;
  onTarget: (v: number) => void;
  onActual: (v: number | null) => void;
  onComment: () => void;
}) {
  const b = band(r.attainmentPct);
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer transition ${selected ? 'bg-primary/5' : 'hover:bg-surface-2'}`}
    >
      <td className="px-4 py-2.5 border-b border-line/40">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-medium text-ink">{r.label}</span>
          {r.poolValue !== null && (
            <span className="text-[11px] text-muted">of {r.poolValue} on bench</span>
          )}
          {r.direction === 'lower' && (
            <span className="text-[11px] text-muted">lower is better</span>
          )}
          {r.actualSource === 'auto' && r.autoActual === null && !r.isOverridden && (
            <span className="text-[11px] text-muted">no data for this scope</span>
          )}
        </div>
      </td>

      <td className="px-4 py-2.5 border-b border-line/40 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1.5">
          {!canEditForecast && <Lock size={11} className="text-amber-600" />}
          <input
            type="number"
            defaultValue={r.targetValue}
            disabled={!canEditForecast || !r.targetId}
            key={`${r.kpiKey}-${r.targetValue}`}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!Number.isNaN(v) && v !== r.targetValue) onTarget(v);
            }}
            className="w-20 text-right tabular-nums bg-transparent text-[14px] rounded px-1.5 py-1
                       border border-transparent hover:border-line focus:border-primary focus:outline-none
                       disabled:cursor-not-allowed disabled:hover:border-transparent"
          />
        </div>
      </td>

      <td className="px-4 py-2.5 border-b border-line/40 text-right" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          defaultValue={r.manualActual ?? (r.actualSource === 'auto' ? r.autoActual ?? '' : '')}
          key={`${r.kpiKey}-a-${r.manualActual}-${r.autoActual}`}
          placeholder="—"
          disabled={!r.targetId}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            const v = raw === '' ? null : Number(raw);
            const current = r.manualActual;
            if (v !== current) onActual(v);
          }}
          className="w-24 text-right tabular-nums bg-transparent text-[15px] font-medium rounded px-1.5 py-1
                     border border-transparent hover:border-line focus:border-primary focus:outline-none"
        />
        {r.isOverridden && (
          <span className="block text-[10px] text-amber-600">
            overwritten{r.autoActual !== null ? ` · auto ${fmt(r.autoActual, r.unit)}` : ''}
          </span>
        )}
      </td>

      <td className="px-4 py-2.5 border-b border-line/40 text-right tabular-nums text-[14px]">
        <span className={
          r.variance === 0 ? 'text-muted'
            : (r.direction === 'lower' ? r.variance < 0 : r.variance > 0)
              ? 'text-emerald-600' : 'text-red-600'
        }>
          {r.variance > 0 ? `+${fmt(r.variance, r.unit)}` : fmt(r.variance, r.unit)}
        </span>
      </td>

      <td className="px-4 py-2.5 border-b border-line/40">
        <div className="flex items-center justify-end gap-2.5">
          <span className="w-[74px] h-1.5 rounded-full bg-line/60 overflow-hidden flex-shrink-0">
            <span
              className={`block h-full rounded-full ${BAND_BAR[b]}`}
              style={{ width: `${r.attainmentPct === null ? 0 : Math.max(0, Math.min(r.attainmentPct, 100))}%` }}
            />
          </span>
          <span className={`min-w-[46px] text-right tabular-nums text-[12.5px] ${BAND_TEXT[b]}`}>
            {r.attainmentPct === null ? '—' : `${r.attainmentPct}%`}
          </span>
        </div>
      </td>

      <td className="px-4 py-2.5 border-b border-line/40 text-right">
        <span className={`text-[9.5px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded ${
          r.actualSource === 'auto'
            ? 'bg-primary/10 text-primary'
            : 'bg-surface-2 text-muted border border-line'
        }`}>
          {r.actualSource}
        </span>
      </td>

      <td className="px-2 py-2.5 border-b border-line/40 text-right" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onComment}
          title="Add an update against this KPI"
          className="p-1.5 rounded-md text-muted hover:text-primary hover:bg-surface-2 transition"
        >
          <MessageSquarePlus size={14} />
        </button>
      </td>
    </tr>
  );
}

function Composer({ kpiKey, rows, onPost, onCancel }: {
  kpiKey: string | null;
  rows: ScorecardRow[];
  onPost: (kpiKey: string | null, note: string, delta: number | null) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [delta, setDelta] = useState('');
  const [target, setTarget] = useState<string>(kpiKey ?? '');

  const open = kpiKey !== null || note.length > 0;

  return (
    <div className="px-4 py-3 border-b border-line/60 bg-surface-2/60 space-y-2">
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add an update against a KPI…"
          className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-[12.5px] focus:outline-none focus:border-primary"
        />
        <button
          onClick={() => { if (note.trim()) onPost(target || null, note.trim(), delta === '' ? null : Number(delta)); setNote(''); setDelta(''); }}
          disabled={!note.trim()}
          className="px-3.5 py-2 rounded-lg bg-primary text-white text-[12.5px] font-medium disabled:opacity-40"
        >
          Post
        </button>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] focus:outline-none focus:border-primary"
          >
            <option value="">General note on the month</option>
            {rows.map((r) => <option key={r.kpiKey} value={r.kpiKey}>{r.label}</option>)}
          </select>
          <input
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            type="number"
            placeholder="+/-"
            title="Optional: how much this update contributes to a manual KPI"
            className="w-20 rounded-lg border border-line bg-surface px-2 py-1.5 text-[12px] focus:outline-none focus:border-primary"
          />
          <button onClick={() => { setNote(''); setDelta(''); onCancel(); }} className="text-[12px] text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function HowPanel({ row, rowCount }: { row: ScorecardRow | null; rowCount: number }) {
  if (!row) {
    return (
      <div className="px-4 py-3.5 space-y-2.5">
        <p className="text-[12.5px] text-muted m-0">Pick a KPI row to see where its number comes from.</p>
        <Rule term="Forecast">Set and locked by the owner. A locked month freezes the forecast and nothing else.</Rule>
        <Rule term="Actual">Auto KPIs compute from the Cockpit and accept an overwrite; manual KPIs are typed in.</Rule>
        <Rule term="Feed">The responsible person comments against each KPI. Dated, attributed, not rewritable by others.</Rule>
        <Rule term="Matrix">{`This card carries ${rowCount} KPI${rowCount === 1 ? '' : 's'}.`}</Rule>
      </div>
    );
  }
  return (
    <div className="px-4 py-3.5 space-y-2.5">
      {row.description && <p className="text-[12.5px] text-muted m-0">{row.description}</p>}
      <Rule term="Source">{row.actualSource === 'auto' ? 'Computed from the Cockpit, overridable' : 'Entered by hand'}</Rule>
      <Rule term="Scope">{row.scopeKey === 'none' ? 'No data scope, so nothing computes automatically.' : `${row.scopeLabel} slice`}</Rule>
      <Rule term="Forecast">{`${fmt(row.targetValue, row.unit)} — ${row.locked ? 'locked' : 'open'}${row.targetSetBy ? ` · last set by ${row.targetSetBy.split('@')[0]}` : ''}`}</Rule>
      <Rule term="Actual">
        {row.isOverridden
          ? `${fmt(row.actualValue, row.unit)} — overwritten by ${row.manualActualBy?.split('@')[0] ?? 'someone'}, computed value was ${fmt(row.autoActual, row.unit)}`
          : `${fmt(row.actualValue, row.unit)} — ${row.actualSource === 'auto' ? 'computed' : 'entered by hand'}`}
      </Rule>
      {row.auditCount > 0 && (
        <Rule term="Changes">{`${row.auditCount} recorded on this KPI — see the audit tab.`}</Rule>
      )}
    </div>
  );
}

function Rule({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 pt-2.5 border-t border-line/40 text-[12.5px]">
      <b className="w-[74px] flex-shrink-0 font-medium text-muted text-[10.5px] uppercase tracking-[0.07em] pt-0.5">{term}</b>
      <span className="flex-1 text-ink/85">{children}</span>
    </div>
  );
}

function AuditPanel({ audit }: { audit: ReturnType<typeof useCheckinStore.getState>['audit'] }) {
  if (!audit.length) {
    return (
      <div className="px-4 py-3.5">
        <p className="text-[12.5px] text-muted m-0">
          Nothing has been changed this month yet. Every forecast edit, every overwritten
          actual and every lock is written here by the database — it cannot be skipped,
          and it cannot be edited afterwards.
        </p>
      </div>
    );
  }
  return (
    <ul className="m-0 p-0 list-none max-h-[420px] overflow-y-auto">
      {audit.map((a) => (
        <li key={a.id} className="px-4 py-2.5 border-b border-line/40 last:border-b-0 text-[12.5px]">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[10.5px] text-muted tabular-nums">
              {new Date(a.changedAt).toLocaleString(undefined, {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
            </span>
            <span className="text-[9.5px] uppercase tracking-[0.06em] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
              {a.field.replace('_', ' ')}
            </span>
          </div>
          <div>
            <span className="font-medium text-ink">{a.changedByName?.split('@')[0] ?? a.changedBy}</span>
            <span className="text-muted">
              {a.field === 'locked'
                ? (a.newValue === 'true' ? ' locked the month' : ' unlocked the month')
                : <>
                    {' '}changed {a.kpiLabel ?? a.field}{' '}
                    <b className="font-medium text-ink tabular-nums">{a.oldValue ?? '—'}</b>
                    {' → '}
                    <b className="font-medium text-ink tabular-nums">{a.newValue ?? '—'}</b>
                  </>}
              {a.ownerName ? ` · ${a.ownerName}` : ''}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
