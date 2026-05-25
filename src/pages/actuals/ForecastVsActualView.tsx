/**
 * Forecast vs Actual comparison view.
 *
 * Inner toggle: Month | Week | Project. Each cell shows (Forecast / Actual / Δ)
 * with a hover tooltip explaining the calculation. Employee matching is exact
 * normalised first, falling back to first-name match so the spreadsheet
 * "Anukanth" lines up with the Zoho "Anukanth Sudarsanam".
 */
import { useEffect, useMemo, useState } from 'react';
import { useActualHoursStore, useForecastStore } from '../../store';
import { MONTHS } from '../../types/forecast';
import type { Month, ForecastAssignment } from '../../types/forecast';
import type { ActualHourEntry } from '../../types/actualHours';
import {
  emptyMonthCounter,
  monthOf,
  isoWeekStart,
  ymd,
  fmtWeek,
  ytdWeeks,
} from './shared';

type ForecastSubTab = 'month' | 'week' | 'project';
const FCAST_SUB_KEY = 'actual-hours-forecast-sub';

function loadForecastSub(): ForecastSubTab {
  if (typeof window === 'undefined') return 'month';
  const v = window.localStorage.getItem(FCAST_SUB_KEY);
  return v === 'week' || v === 'project' ? v : 'month';
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}
function firstNameKey(s: string): string {
  const n = normName(s);
  return n.split(' ')[0] || n;
}

function buildActualLookupByEmployee(entries: ActualHourEntry[]) {
  const exact = new Map<string, ActualHourEntry[]>();
  const byFirst = new Map<string, ActualHourEntry[]>();
  for (const e of entries) {
    const full = normName(e.employeeName);
    const first = firstNameKey(e.employeeName);
    if (!exact.has(full)) exact.set(full, []);
    exact.get(full)!.push(e);
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first)!.push(e);
  }
  return (forecastName: string): ActualHourEntry[] => {
    const full = normName(forecastName);
    if (exact.has(full)) return exact.get(full)!;
    const first = firstNameKey(forecastName);
    return byFirst.get(first) ?? [];
  };
}

function fmtSigned(n: number): string {
  if (Math.abs(n) < 0.5) return '0';
  return (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
}

function deltaColor(forecast: number, actual: number): string {
  if (forecast <= 0 && actual <= 0) return 'text-slate-300';
  if (forecast <= 0) return 'bg-sky-50 text-sky-700';
  if (actual <= 0) return 'bg-slate-50 text-slate-400';
  const ratio = actual / forecast;
  const off = Math.abs(ratio - 1);
  if (off <= 0.1) return 'bg-emerald-50 text-emerald-700';
  if (off <= 0.25) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

function tooltip(label: string, forecast: number, actual: number): string {
  const delta = actual - forecast;
  const pct = forecast > 0 ? Math.round((actual / forecast - 1) * 100) : null;
  const pctStr = pct === null ? 'n/a (no forecast)' : `${pct > 0 ? '+' : ''}${pct}%`;
  return [
    label,
    `  Forecast: ${forecast.toFixed(1)} hrs`,
    `  Actual:   ${actual.toFixed(1)} hrs`,
    `  Δ:        ${delta > 0 ? '+' : ''}${delta.toFixed(1)} hrs (${pctStr})`,
  ].join('\n');
}

interface ForecastVsActualProps {
  search?: string;
}

export default function ForecastVsActualView({ search = '' }: ForecastVsActualProps) {
  const entries = useActualHoursStore((s) => s.entries);
  const assignments = useForecastStore((s) => s.assignments);
  const [sub, setSub] = useState<ForecastSubTab>(() => loadForecastSub());
  useEffect(() => {
    try { window.localStorage.setItem(FCAST_SUB_KEY, sub); } catch { /* ignore */ }
  }, [sub]);

  const lookupActual = useMemo(() => buildActualLookupByEmployee(entries), [entries]);

  const employeeNames = useMemo(() => {
    const set = new Map<string, string>();
    for (const a of assignments) set.set(normName(a.employeeName), a.employeeName);
    for (const e of entries) {
      const k = normName(e.employeeName);
      if (!set.has(k)) set.set(k, e.employeeName);
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [assignments, entries]);

  const filteredEmployees = useMemo(() => {
    if (!search) return employeeNames;
    const q = search.toLowerCase();
    return employeeNames.filter((n) => n.toLowerCase().includes(q));
  }, [employeeNames, search]);

  if (assignments.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">
        No forecast data — fill in the Project Team page first.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider">Compare by</span>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          <SubToggle active={sub === 'month'} onClick={() => setSub('month')}>Month</SubToggle>
          <SubToggle active={sub === 'week'} onClick={() => setSub('week')}>Week</SubToggle>
          <SubToggle active={sub === 'project'} onClick={() => setSub('project')}>Project</SubToggle>
        </div>
        <span className="ml-3 text-[10px] text-slate-400">
          Hover any cell for the calculation.
        </span>
      </div>

      <Legend />

      {sub === 'month' && <FCMonthView employees={filteredEmployees} assignments={assignments} lookupActual={lookupActual} />}
      {sub === 'week' && <FCWeekView employees={filteredEmployees} assignments={assignments} lookupActual={lookupActual} />}
      {sub === 'project' && <FCProjectView employees={filteredEmployees} assignments={assignments} lookupActual={lookupActual} />}
    </div>
  );
}

function SubToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 border-r last:border-r-0 border-slate-200 ${
        active ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3 text-[10px] text-slate-500">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" /> ≤10% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200" /> ≤25% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-50 border border-rose-200" /> &gt;25% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-50 border border-sky-200" /> unplanned (actual w/o forecast)</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-50 border border-slate-200" /> no actuals yet</span>
    </div>
  );
}

interface SubViewProps {
  employees: string[];
  assignments: ForecastAssignment[];
  lookupActual: (forecastName: string) => ActualHourEntry[];
}

/* ─── Month sub-view ───────────────────────────────────────────── */
function FCMonthView({ employees, assignments, lookupActual }: SubViewProps) {
  const forecastByEmpMonth = useMemo(() => {
    const map = new Map<string, Record<Month, number>>();
    for (const a of assignments) {
      const k = normName(a.employeeName);
      let bucket = map.get(k);
      if (!bucket) { bucket = emptyMonthCounter(); map.set(k, bucket); }
      for (const m of MONTHS) bucket[m] += a.monthlyTotals[m] ?? 0;
    }
    return map;
  }, [assignments]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th rowSpan={2} className="pb-2 pr-3 font-semibold text-slate-600 align-bottom min-w-[180px]">Employee</th>
            {MONTHS.map((m) => (
              <th key={m} colSpan={3} className="px-1.5 text-center font-semibold text-slate-600 text-xs border-l border-slate-100">{m}</th>
            ))}
          </tr>
          <tr className="border-b border-slate-200 text-left">
            {MONTHS.map((m) => <FCHeaderTriplet key={m} />)}
          </tr>
        </thead>
        <tbody>
          {employees.map((name) => {
            const fkey = normName(name);
            const fcastMonthly = forecastByEmpMonth.get(fkey) ?? emptyMonthCounter();
            const actuals = lookupActual(name);
            const actMonthly = emptyMonthCounter();
            for (const e of actuals) {
              if (!e.workDate || e.hours <= 0) continue;
              actMonthly[monthOf(e.workDate)] += e.hours;
            }
            return (
              <tr key={name} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800">{name}</td>
                {MONTHS.map((m) => {
                  const f = fcastMonthly[m];
                  const a = actMonthly[m];
                  return (
                    <FCTriplet key={m} forecast={f} actual={a} delta={a - f} title={tooltip(`${name} — ${m}`, f, a)} />
                  );
                })}
              </tr>
            );
          })}
          {employees.length > 1 && (() => {
            const totalF = emptyMonthCounter();
            const totalA = emptyMonthCounter();
            for (const name of employees) {
              const fkey = normName(name);
              const fc = forecastByEmpMonth.get(fkey);
              if (fc) for (const m of MONTHS) totalF[m] += fc[m];
              for (const e of lookupActual(name)) {
                if (!e.workDate || e.hours <= 0) continue;
                totalA[monthOf(e.workDate)] += e.hours;
              }
            }
            return (
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td className="py-2 pr-3 text-slate-700">Total ({employees.length})</td>
                {MONTHS.map((m) => (
                  <FCTriplet key={m} forecast={totalF[m]} actual={totalA[m]} delta={totalA[m] - totalF[m]} title={tooltip(`All — ${m}`, totalF[m], totalA[m])} />
                ))}
              </tr>
            );
          })()}
        </tbody>
      </table>
    </div>
  );
}

function FCHeaderTriplet() {
  return (
    <>
      <th className="pb-2 px-1 font-semibold text-slate-400 text-[9px] text-right uppercase border-l border-slate-100">F</th>
      <th className="pb-2 px-1 font-semibold text-slate-400 text-[9px] text-right uppercase">A</th>
      <th className="pb-2 px-1 font-semibold text-slate-400 text-[9px] text-right uppercase">Δ</th>
    </>
  );
}

function FCTriplet({ forecast, actual, delta, title }: {
  forecast: number; actual: number; delta: number; title: string;
}) {
  const color = deltaColor(forecast, actual);
  return (
    <>
      <td className="py-1.5 px-1 text-right tabular-nums text-[11px] text-slate-500 border-l border-slate-100" title={title}>
        {forecast > 0 ? forecast.toFixed(0) : '—'}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums text-[11px] text-slate-700" title={title}>
        {actual > 0 ? actual.toFixed(0) : '—'}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums" title={title}>
        <span className={`inline-block px-1 py-0.5 rounded text-[11px] font-semibold ${color}`}>
          {(forecast > 0 || actual > 0) ? fmtSigned(delta) : '—'}
        </span>
      </td>
    </>
  );
}

/* ─── Week sub-view ────────────────────────────────────────────── */
function FCWeekView({ employees, assignments, lookupActual }: SubViewProps) {
  const weeks = useMemo(() => ytdWeeks(), []);
  const weekIndex = useMemo(() => new Map(weeks.map((w, i) => [w, i])), [weeks]);

  const forecastByEmpWeek = useMemo(() => {
    const weeksPerMonth: Record<Month, number> = emptyMonthCounter();
    for (const w of weeks) weeksPerMonth[monthOf(w)] += 1;

    const map = new Map<string, Record<string, number>>();
    for (const a of assignments) {
      const k = normName(a.employeeName);
      let bucket = map.get(k);
      if (!bucket) { bucket = {}; for (const w of weeks) bucket[w] = 0; map.set(k, bucket); }
      const hasWeekly = Object.keys(a.weeklyHours || {}).some((d) => (a.weeklyHours[d] ?? 0) > 0);
      if (hasWeekly) {
        for (const w of weeks) bucket[w] += a.weeklyHours[w] ?? 0;
      } else {
        for (const w of weeks) {
          const m = monthOf(w);
          const total = a.monthlyTotals[m] ?? 0;
          const denom = weeksPerMonth[m] || 1;
          bucket[w] += total / denom;
        }
      }
    }
    return map;
  }, [assignments, weeks]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th rowSpan={2} className="pb-2 pr-3 font-semibold text-slate-600 align-bottom min-w-[180px] sticky left-0 bg-white">Employee</th>
            {weeks.map((w) => (
              <th key={w} colSpan={3} className="px-1 font-semibold text-slate-500 text-center text-[10px] whitespace-nowrap border-l border-slate-100">
                {fmtWeek(w)}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-200">
            {weeks.map((w) => <FCHeaderTriplet key={w} />)}
          </tr>
        </thead>
        <tbody>
          {employees.map((name) => {
            const fkey = normName(name);
            const fcast = forecastByEmpWeek.get(fkey) ?? {};
            const actMap: Record<string, number> = {};
            for (const w of weeks) actMap[w] = 0;
            for (const e of lookupActual(name)) {
              if (!e.workDate || e.hours <= 0) continue;
              const ws = ymd(isoWeekStart(new Date(e.workDate + 'T00:00:00Z')));
              if (weekIndex.has(ws)) actMap[ws] += e.hours;
            }
            return (
              <tr key={name} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800 sticky left-0 bg-white">{name}</td>
                {weeks.map((w) => {
                  const f = fcast[w] ?? 0;
                  const a = actMap[w];
                  return <FCTriplet key={w} forecast={f} actual={a} delta={a - f} title={tooltip(`${name} — week of ${fmtWeek(w)}`, f, a)} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Project sub-view ─────────────────────────────────────────── */
function FCProjectView({ employees, assignments, lookupActual }: SubViewProps) {
  const projKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="pb-2 pr-3 font-semibold text-slate-600 min-w-[160px]">Employee</th>
            <th className="pb-2 pr-3 font-semibold text-slate-600 min-w-[200px]">Project</th>
            <th className="pb-2 pr-2 font-semibold text-slate-500 text-right text-xs">Forecast YTD</th>
            <th className="pb-2 pr-2 font-semibold text-slate-500 text-right text-xs">Actual YTD</th>
            <th className="pb-2 pl-2 font-semibold text-slate-500 text-right text-xs">Δ</th>
          </tr>
        </thead>
        <tbody>
          {employees.flatMap((name) => {
            const fkey = normName(name);
            const fcastByProj = new Map<string, { display: string; total: number }>();
            for (const a of assignments) {
              if (normName(a.employeeName) !== fkey) continue;
              const total = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
              const key = projKey(a.project);
              const prev = fcastByProj.get(key);
              fcastByProj.set(key, { display: a.project, total: (prev?.total ?? 0) + total });
            }
            const actByProj = new Map<string, { display: string; total: number }>();
            for (const e of lookupActual(name)) {
              if (!e.project || e.hours <= 0) continue;
              const key = projKey(e.project);
              const prev = actByProj.get(key);
              actByProj.set(key, { display: e.project, total: (prev?.total ?? 0) + e.hours });
            }

            const remainingActuals = new Map(actByProj);
            const rows: Array<{ key: string; project: string; forecast: number; actual: number; source: 'matched' | 'forecastOnly' | 'actualOnly' }> = [];

            for (const [fk, f] of fcastByProj) {
              let matchedKey: string | null = null;
              for (const ak of remainingActuals.keys()) {
                if (ak.includes(fk) || fk.includes(ak)) { matchedKey = ak; break; }
              }
              if (matchedKey) {
                const a = remainingActuals.get(matchedKey)!;
                rows.push({ key: `${fk}|${matchedKey}`, project: `${f.display} ⇆ ${a.display}`, forecast: f.total, actual: a.total, source: 'matched' });
                remainingActuals.delete(matchedKey);
              } else {
                rows.push({ key: fk, project: f.display, forecast: f.total, actual: 0, source: 'forecastOnly' });
              }
            }
            for (const [ak, a] of remainingActuals) {
              rows.push({ key: ak, project: a.display, forecast: 0, actual: a.total, source: 'actualOnly' });
            }
            rows.sort((a, b) => b.actual + b.forecast - (a.actual + a.forecast));

            if (rows.length === 0) {
              return [(
                <tr key={`${name}-empty`} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{name}</td>
                  <td colSpan={4} className="py-1.5 text-xs text-slate-400 italic">No forecast or actuals.</td>
                </tr>
              )];
            }
            return rows.map((r, i) => (
              <tr key={`${name}-${r.key}-${i}`} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800">{i === 0 ? name : ''}</td>
                <td className="py-1.5 pr-3 text-slate-700">
                  {r.project}
                  {r.source === 'forecastOnly' && <span className="ml-1.5 text-[9px] text-slate-400 italic">(no actual)</span>}
                  {r.source === 'actualOnly' && <span className="ml-1.5 text-[9px] text-sky-500 italic">(unplanned)</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{r.forecast > 0 ? r.forecast.toFixed(0) : '—'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">{r.actual > 0 ? r.actual.toFixed(0) : '—'}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums" title={tooltip(`${name} — ${r.project}`, r.forecast, r.actual)}>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${deltaColor(r.forecast, r.actual)}`}>
                    {fmtSigned(r.actual - r.forecast)}
                  </span>
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
