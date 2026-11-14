/**
 * Margin maths shared by the requisition form ("Approved cost / month") and the
 * standalone Margin Calculator.
 *
 * Margin is taken on the client budget:  approved cost = budget x (1 - margin).
 * A $15/hr budget at the standard 30% margin gives a $10.50/hr approved cost.
 *
 * Hourly <-> monthly uses 160 hours a month and USD <-> INR uses 93, the same
 * basis as the India roster cost load (monthly INR / 14,880 = USD per hour).
 * Both are editable in the calculator; the requisition form always uses the defaults.
 */

export const DEFAULT_FX_INR_PER_USD = 93;
export const DEFAULT_HOURS_PER_MONTH = 160;
/** Margin TA can commit to without asking anyone. */
export const STANDARD_MARGIN_PCT = 30;
/** Below this, Finance cannot approve on its own. */
export const EXCEPTION_MARGIN_PCT = 20;

export type RateUnit = 'inr_month' | 'usd_hour' | 'inr_hour';

export const RATE_UNIT_LABELS: Record<RateUnit, string> = {
  inr_month: 'INR per month',
  usd_hour: 'USD per hour',
  inr_hour: 'INR per hour',
};

export interface RateBasis {
  fxInrPerUsd: number;
  hoursPerMonth: number;
}
export const DEFAULT_BASIS: RateBasis = { fxInrPerUsd: DEFAULT_FX_INR_PER_USD, hoursPerMonth: DEFAULT_HOURS_PER_MONTH };

/** Any supported unit -> USD per hour. Returns NaN for an unusable amount or basis. */
export function toUsdPerHour(amount: number, unit: RateUnit, basis: RateBasis = DEFAULT_BASIS): number {
  if (!Number.isFinite(amount) || amount < 0 || !(basis.fxInrPerUsd > 0) || !(basis.hoursPerMonth > 0)) return NaN;
  switch (unit) {
    case 'usd_hour': return amount;
    case 'inr_hour': return amount / basis.fxInrPerUsd;
    case 'inr_month': return amount / basis.hoursPerMonth / basis.fxInrPerUsd;
  }
}

/** USD per hour -> any supported unit. */
export function fromUsdPerHour(usdPerHour: number, unit: RateUnit, basis: RateBasis = DEFAULT_BASIS): number {
  if (!Number.isFinite(usdPerHour)) return NaN;
  switch (unit) {
    case 'usd_hour': return usdPerHour;
    case 'inr_hour': return usdPerHour * basis.fxInrPerUsd;
    case 'inr_month': return usdPerHour * basis.fxInrPerUsd * basis.hoursPerMonth;
  }
}

/** The most a candidate may cost for the given budget and margin, in the budget's own unit. */
export function approvedCost(budget: number, marginPct: number): number {
  if (!Number.isFinite(budget) || !Number.isFinite(marginPct)) return NaN;
  return budget * (1 - marginPct / 100);
}

/** Approved cost per month in INR for a USD/hr budget at the standard margin. Null when there is no budget. */
export function approvedCostInrPerMonth(budgetUsdPerHour: number | null | undefined, marginPct = STANDARD_MARGIN_PCT): number | null {
  if (budgetUsdPerHour == null || !(budgetUsdPerHour > 0)) return null;
  return Math.round(fromUsdPerHour(approvedCost(budgetUsdPerHour, marginPct), 'inr_month'));
}

export type MarginBand = 'standard' | 'finance' | 'exception';

/** 30% and above: go ahead. 20% up to 30%: Finance. Below 20%: exception approval. */
export function marginBand(marginPct: number): MarginBand {
  if (marginPct >= STANDARD_MARGIN_PCT) return 'standard';
  if (marginPct >= EXCEPTION_MARGIN_PCT) return 'finance';
  return 'exception';
}

export const MARGIN_BAND_COPY: Record<MarginBand, { title: string; detail: string }> = {
  standard: {
    title: 'No approval needed',
    detail: `At ${STANDARD_MARGIN_PCT}% margin or more, TA can proceed at this cost.`,
  },
  finance: {
    title: 'Special approval needed: Finance',
    detail: `Margin is below ${STANDARD_MARGIN_PCT}%. Get Finance approval before committing this cost to a vendor or candidate.`,
  },
  exception: {
    title: 'Special approval needed: Raghu or Manjunath',
    detail: `Margin is below ${EXCEPTION_MARGIN_PCT}%. This is an exception and needs approval from Raghu or Manjunath before you commit.`,
  },
};

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₹1,56,240 / month", "$10.50 / hr", "₹976.50 / hr". An em dash for an unusable value. */
export function formatRate(value: number | null | undefined, unit: RateUnit): string {
  if (value == null || !Number.isFinite(value)) return '—';
  switch (unit) {
    case 'inr_month': return `₹${inr0.format(Math.round(value))} / month`;
    case 'usd_hour': return `$${usd2.format(value)} / hr`;
    case 'inr_hour': return `₹${inr2.format(value)} / hr`;
  }
}
