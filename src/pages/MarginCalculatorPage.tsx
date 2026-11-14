/**
 * Margin Calculator — "what is the most this candidate can cost?"
 *
 * Standalone on purpose: TA uses it while negotiating with a vendor or candidate,
 * often before a requisition exists, and it is not tied to any requisition.
 *
 * Enter the client budget in INR per month, USD per hour or INR per hour. The page
 * takes the margin off (30% by default) and shows the approved cost, in INR per
 * month or USD per hour. Dropping the margin below 30% is allowed, and the page
 * says whose approval that needs. Nothing is saved; the maths lives in src/lib/margin.ts.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import {
  DEFAULT_FX_INR_PER_USD, DEFAULT_HOURS_PER_MONTH, STANDARD_MARGIN_PCT, EXCEPTION_MARGIN_PCT,
  RATE_UNIT_LABELS, MARGIN_BAND_COPY,
  toUsdPerHour, fromUsdPerHour, approvedCost, marginBand, formatRate,
  type RateUnit, type MarginBand,
} from '../lib/margin';

const BUDGET_UNITS: RateUnit[] = ['inr_month', 'usd_hour', 'inr_hour'];
const RESULT_UNITS: RateUnit[] = ['inr_month', 'usd_hour'];
const MAX_MARGIN = 60;

const BAND_STYLE: Record<MarginBand, { box: string; icon: typeof CheckCircle2 }> = {
  standard:  { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CheckCircle2 },
  finance:   { box: 'border-amber-300 bg-amber-50 text-amber-900',       icon: AlertTriangle },
  exception: { box: 'border-rose-300 bg-rose-50 text-rose-900',          icon: ShieldAlert },
};

const FIELD = 'w-full px-3 py-2 rounded-lg border border-line bg-surface text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const LABEL = 'text-xs font-semibold text-muted uppercase tracking-wider';

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2/60 p-0.5 flex-wrap">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function MarginCalculatorPage() {
  const [budgetText, setBudgetText] = useState('15');
  const [budgetUnit, setBudgetUnit] = useState<RateUnit>('usd_hour');
  const [resultUnit, setResultUnit] = useState<RateUnit>('inr_month');
  const [margin, setMargin] = useState(STANDARD_MARGIN_PCT);
  const [fxText, setFxText] = useState(String(DEFAULT_FX_INR_PER_USD));
  const [hoursText, setHoursText] = useState(String(DEFAULT_HOURS_PER_MONTH));

  const calc = useMemo(() => {
    const budget = Number(budgetText);
    const basis = { fxInrPerUsd: Number(fxText), hoursPerMonth: Number(hoursText) };
    const basisOk = basis.fxInrPerUsd > 0 && basis.hoursPerMonth > 0;
    const ok = budgetText.trim() !== '' && Number.isFinite(budget) && budget > 0 && basisOk;
    const budgetUsd = ok ? toUsdPerHour(budget, budgetUnit, basis) : NaN;
    const costUsd = approvedCost(budgetUsd, margin);
    const at = (usd: number, unit: RateUnit) => fromUsdPerHour(usd, unit, basis);
    return { ok, basisOk, basis, budgetUsd, costUsd, at };
  }, [budgetText, budgetUnit, margin, fxText, hoursText]);

  const band = marginBand(margin);
  const BandIcon = BAND_STYLE[band].icon;
  const otherResultUnit: RateUnit = resultUnit === 'inr_month' ? 'usd_hour' : 'inr_month';
  const basisChanged = Number(fxText) !== DEFAULT_FX_INR_PER_USD || Number(hoursText) !== DEFAULT_HOURS_PER_MONTH;

  const reset = () => {
    setBudgetText('15'); setBudgetUnit('usd_hour'); setResultUnit('inr_month'); setMargin(STANDARD_MARGIN_PCT);
    setFxText(String(DEFAULT_FX_INR_PER_USD)); setHoursText(String(DEFAULT_HOURS_PER_MONTH));
  };

  return (
    <div>
      <PageHeader
        title="Margin Calculator"
        subtitle="Enter the client budget and see the most a candidate or vendor can cost at the margin you choose."
        action={
          <button type="button" onClick={reset}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink px-3 py-1.5 rounded-lg border border-line bg-surface">
            <RotateCcw size={12} /> Reset
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ── Inputs ── */}
        <Card>
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <label htmlFor="mc-budget" className={LABEL}>Client budget</label>
                <Segmented label="Client budget unit" value={budgetUnit} onChange={setBudgetUnit}
                  options={BUDGET_UNITS.map((u) => ({ value: u, label: RATE_UNIT_LABELS[u] }))} />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">
                  {budgetUnit === 'usd_hour' ? '$' : '₹'}
                </span>
                <input id="mc-budget" type="number" inputMode="decimal" min={0} step="any" value={budgetText}
                  onChange={(e) => setBudgetText(e.target.value)} className={`${FIELD} pl-7 text-base font-semibold`}
                  aria-describedby="mc-budget-help" />
              </div>
              <p id="mc-budget-help" className="text-xs text-muted mt-1.5">
                {calc.ok
                  ? <>Same budget: {BUDGET_UNITS.filter((u) => u !== budgetUnit).map((u) => formatRate(calc.at(calc.budgetUsd, u), u)).join(' · ')}</>
                  : 'Enter what the client pays for this role.'}
              </p>
            </div>

            <div>
              <div className="flex items-end justify-between gap-3 mb-2">
                <label htmlFor="mc-margin" className={LABEL}>Margin</label>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={0} max={MAX_MARGIN} step={1} value={margin} aria-label="Margin percent"
                    onChange={(e) => setMargin(Math.max(0, Math.min(MAX_MARGIN, Number(e.target.value) || 0)))}
                    className={`${FIELD} !w-20 text-right font-semibold`} />
                  <span className="text-sm text-muted">%</span>
                </div>
              </div>
              <input id="mc-margin" type="range" min={0} max={MAX_MARGIN} step={1} value={margin}
                onChange={(e) => setMargin(Number(e.target.value))} className="w-full accent-primary" list="mc-margin-marks" />
              <datalist id="mc-margin-marks">
                <option value={EXCEPTION_MARGIN_PCT} /><option value={STANDARD_MARGIN_PCT} />
              </datalist>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {[STANDARD_MARGIN_PCT, 25, EXCEPTION_MARGIN_PCT].map((m) => (
                  <button key={m} type="button" onClick={() => setMargin(m)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      margin === m ? 'bg-primary text-white border-primary' : 'bg-surface text-ink/80 border-line hover:bg-surface-2'}`}>
                    {m}%{m === STANDARD_MARGIN_PCT ? ' standard' : ''}
                  </button>
                ))}
              </div>
            </div>

            <details className="rounded-lg border border-line/70 bg-surface-2/40 px-3 py-2">
              <summary className="text-xs font-semibold text-muted cursor-pointer select-none">
                Conversion basis: ₹{fxText || '—'} per USD, {hoursText || '—'} hours a month{basisChanged ? ' (changed)' : ''}
              </summary>
              <div className="grid grid-cols-2 gap-3 mt-3 mb-1">
                <div>
                  <label htmlFor="mc-fx" className={LABEL}>INR per USD</label>
                  <input id="mc-fx" type="number" min={1} step="any" value={fxText} onChange={(e) => setFxText(e.target.value)} className={`${FIELD} mt-1`} />
                </div>
                <div>
                  <label htmlFor="mc-hours" className={LABEL}>Hours per month</label>
                  <input id="mc-hours" type="number" min={1} step="any" value={hoursText} onChange={(e) => setHoursText(e.target.value)} className={`${FIELD} mt-1`} />
                </div>
              </div>
              {!calc.basisOk && <p className="text-xs text-rose-700 mt-1">Both values must be above zero.</p>}
            </details>
          </div>
        </Card>

        {/* ── Result ── */}
        <Card>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <span className={LABEL}>Approved cost for the candidate</span>
            <Segmented label="Show approved cost in" value={resultUnit} onChange={setResultUnit}
              options={RESULT_UNITS.map((u) => ({ value: u, label: RATE_UNIT_LABELS[u] }))} />
          </div>

          <div aria-live="polite">
            <div className="text-4xl font-extrabold tracking-tight text-ink tabular-nums">
              {calc.ok ? formatRate(calc.at(calc.costUsd, resultUnit), resultUnit) : '—'}
            </div>
            <p className="text-sm text-muted mt-1.5">
              {calc.ok
                ? <>That is {formatRate(calc.at(calc.costUsd, otherResultUnit), otherResultUnit)}: the budget less {margin}%. Do not go above this.</>
                : 'Enter a client budget to see the approved cost.'}
            </p>
          </div>

          <div className={`mt-5 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${BAND_STYLE[band].box}`} role="status">
            <BandIcon size={18} className="mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-sm font-bold">{MARGIN_BAND_COPY[band].title}</div>
              <div className="text-xs mt-0.5 opacity-90">{MARGIN_BAND_COPY[band].detail}</div>
            </div>
          </div>

          {calc.ok && (
            <table className="w-full text-sm mt-5">
              <caption className="sr-only">Approved cost at each approval level</caption>
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-line">
                  <th className="py-2 pr-3 font-semibold">Margin</th>
                  <th className="py-2 pr-3 font-semibold text-right">INR / month</th>
                  <th className="py-2 pr-3 font-semibold text-right">USD / hr</th>
                  <th className="py-2 font-semibold">Approval</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[STANDARD_MARGIN_PCT, 25, EXCEPTION_MARGIN_PCT].map((m) => {
                  const usd = approvedCost(calc.budgetUsd, m);
                  const b = marginBand(m);
                  return (
                    <tr key={m} className={`border-b border-line/60 ${m === margin ? 'bg-primary/5 font-semibold' : ''}`}>
                      <td className="py-2 pr-3">{m}%</td>
                      <td className="py-2 pr-3 text-right">{formatRate(calc.at(usd, 'inr_month'), 'inr_month').replace(' / month', '')}</td>
                      <td className="py-2 pr-3 text-right">{formatRate(usd, 'usd_hour').replace(' / hr', '')}</td>
                      <td className="py-2 text-xs">{b === 'standard' ? 'None' : b === 'finance' ? 'Finance' : 'Raghu or Manjunath'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
