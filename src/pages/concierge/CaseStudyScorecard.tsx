/**
 * CaseStudyScorecard — Concierge → "Case Studies" tab.
 *
 * Three views over one data file (src/data/caseStudies.ts):
 *   AI · Concierge · Implementations
 *
 * The Concierge view is driven by the live concierge_accounts list, so every
 * Concierge client shows up — the ones with no case study yet appear as
 * "Not written yet" cards. Each card is graded on five fields (business
 * problem, solution, outcomes, what we've done, Salesforce products); click a
 * card for the full write-up.
 */
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Search, Sparkles, Headset, Rocket, CheckCircle2, PenLine, CircleDashed, Layers } from 'lucide-react';
import { useConciergeAccountsStore } from '../../store/useConciergeAccountsStore';
import { Badge, Drawer, StatCard } from '../../components/ui';
import {
  CASE_STUDIES, SCORE_FIELDS, SCORE_LABEL, TRACK_LABEL, completeness, isFilled,
} from '../../data/caseStudies';
import type { CaseStudy, CaseStudyTrack } from '../../data/caseStudies';

type Row =
  | { kind: 'study'; key: string; study: CaseStudy; accounts: string[]; dormant: boolean | null }
  | { kind: 'missing'; key: string; accountName: string; industry: string | null; dormant: boolean };

const TRACKS: Array<{ key: CaseStudyTrack; icon: JSX.Element }> = [
  { key: 'ai', icon: <Sparkles size={14} /> },
  { key: 'concierge', icon: <Headset size={14} /> },
  { key: 'implementation', icon: <Rocket size={14} /> },
];

const MAX = SCORE_FIELDS.length;

function initials(name: string) {
  return name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function scoreTone(n: number) {
  if (n >= MAX) return { bar: 'bg-green', text: 'text-green' };
  if (n >= 3) return { bar: 'bg-brand', text: 'text-brand' };
  if (n >= 1) return { bar: 'bg-gold', text: 'text-gold' };
  return { bar: 'bg-line', text: 'text-muted' };
}

/** Five segments, one per graded field. */
function ScoreBar({ study }: { study: CaseStudy | null }) {
  const n = study ? completeness(study) : 0;
  const tone = scoreTone(n);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5 flex-1">
        {SCORE_FIELDS.map((f) => (
          <span
            key={f}
            title={`${SCORE_LABEL[f]}${study && isFilled(study, f) ? '' : ' — missing'}`}
            className={`h-1.5 flex-1 rounded-full ${study && isFilled(study, f) ? tone.bar : 'bg-surface-2'}`}
          />
        ))}
      </div>
      <span className={`text-[11px] font-bold tabular-nums ${tone.text}`}>{n}/{MAX}</span>
    </div>
  );
}

function Chips({ items, max = 4, tone = 'info' }: { items: string[]; max?: number; tone?: 'info' | 'neutral' }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((p) => <Badge key={p} variant={tone}>{p}</Badge>)}
      {items.length > max && <Badge variant="neutral">+{items.length - max}</Badge>}
    </div>
  );
}

function StudyCard({ row, onOpen }: { row: Extract<Row, { kind: 'study' }>; onOpen: () => void }) {
  const s = row.study;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-surface rounded-2xl border border-line/70 shadow-[0_16px_48px_#0f1b2d14] hover:shadow-[0_20px_56px_#0f1b2d1f] hover:border-brand/40 transition-all p-5 flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-navy/10 text-navy flex items-center justify-center text-sm font-bold flex-shrink-0">
          {initials(s.client)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink truncate">{s.client}</p>
          <p className="text-xs text-muted truncate">{s.industry}{s.location ? ` · ${s.location}` : ''}</p>
        </div>
        {s.metric && (
          <div className="text-right flex-shrink-0 max-w-[40%]">
            <p className="text-lg font-bold text-brand leading-none tracking-[-0.02em]">{s.metric.value}</p>
            <p className="text-[10px] text-muted mt-1 leading-tight">{s.metric.label}</p>
          </div>
        )}
      </div>
      <p className="text-sm text-ink/80 line-clamp-2">{s.summary}</p>
      <Chips items={s.salesforce.length ? s.salesforce : s.stack} tone={s.salesforce.length ? 'info' : 'neutral'} />
      <div className="mt-auto pt-2 space-y-2">
        <ScoreBar study={s} />
        <div className="flex flex-wrap items-center gap-1.5">
          {s.source === 'profile'
            ? <Badge variant="warning">Draft · from account profile</Badge>
            : <Badge variant="success">Case study deck</Badge>}
          {row.accounts.length > 1 && <Badge variant="neutral">{row.accounts.length} concierge accounts</Badge>}
          {row.dormant === true && <Badge variant="danger">Dormant</Badge>}
        </div>
      </div>
    </button>
  );
}

function MissingCard({ row }: { row: Extract<Row, { kind: 'missing' }> }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-5 flex flex-col gap-3 bg-surface-2/30">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-surface-2 text-muted flex items-center justify-center text-sm font-bold flex-shrink-0">
          {initials(row.accountName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-ink truncate">{row.accountName}</p>
          <p className="text-xs text-muted truncate">{row.industry || 'Industry not set'}</p>
        </div>
      </div>
      <p className="text-sm text-muted italic">Not written yet — add problem, solution, outcomes, what we’ve done and products.</p>
      <div className="mt-auto pt-2 space-y-2">
        <ScoreBar study={null} />
        <div className="flex gap-1.5">
          <Badge variant="neutral">No case study</Badge>
          {row.dormant && <Badge variant="danger">Dormant</Badge>}
        </div>
      </div>
    </div>
  );
}

function Section({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  const real = items.filter((l) => l.trim());
  return (
    <section>
      <p className="eyebrow mb-2">{title}</p>
      {real.length === 0 ? (
        <p className="text-sm text-muted italic">{empty ?? 'Not captured yet.'}</p>
      ) : (
        <ul className="space-y-1.5">
          {real.map((l) => (
            <li key={l} className={`text-sm flex gap-2 ${/^pending/i.test(l) ? 'text-muted italic' : 'text-ink/90'}`}>
              <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand flex-shrink-0" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StudyDrawer({ row, onClose }: { row: Extract<Row, { kind: 'study' }> | null; onClose: () => void }) {
  const s = row?.study;
  return (
    <Drawer open={!!s} onClose={onClose} title={s?.client ?? ''} width="max-w-2xl">
      {s && (
        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm text-muted">{s.industry}{s.location ? ` · ${s.location}` : ''}</p>
            <p className="text-ink">{s.summary}</p>
            <div className="flex flex-wrap gap-1.5">
              {s.tracks.map((t) => <Badge key={t} variant="default">{TRACK_LABEL[t]}</Badge>)}
              {s.source === 'profile'
                ? <Badge variant="warning">Draft from account profile — review before sharing</Badge>
                : <Badge variant="success">From Case Studies 2026 deck</Badge>}
              {row && row.accounts.length > 0 && <Badge variant="neutral">Concierge: {row.accounts.join(', ')}</Badge>}
            </div>
          </div>
          {s.metric && (
            <div className="rounded-xl bg-brand/10 border border-brand/20 px-4 py-3 flex items-baseline gap-3">
              <span className="text-2xl font-bold text-brand tracking-[-0.02em]">{s.metric.value}</span>
              <span className="text-sm text-ink/80">{s.metric.label}</span>
            </div>
          )}
          <ScoreBar study={s} />
          <Section title="Business problem" items={s.problem} />
          <Section title="Solution" items={s.solution} />
          <Section title="Outcomes" items={s.outcomes} />
          <Section title="What we’ve done" items={s.whatWeDid} />
          <section>
            <p className="eyebrow mb-2">Salesforce products</p>
            {s.salesforce.length ? <Chips items={s.salesforce} max={99} /> : <p className="text-sm text-muted italic">No Salesforce products — non-Salesforce engagement.</p>}
            {s.stack.length > 0 && (
              <>
                <p className="eyebrow mt-4 mb-2">Rest of the stack</p>
                <Chips items={s.stack} max={99} tone="neutral" />
              </>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

export function CaseStudyScorecard() {
  const { accounts } = useConciergeAccountsStore();
  const [track, setTrack] = useState<CaseStudyTrack>('concierge');
  const [q, setQ] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const rowsByTrack = useMemo(() => {
    const byAccount = new Map<string, CaseStudy>();
    for (const s of CASE_STUDIES) {
      if (s.accountName) byAccount.set(s.accountName.toLowerCase(), s);
      for (const a of s.alsoAccounts ?? []) byAccount.set(a.toLowerCase(), s);
    }
    const dormantByName = new Map(accounts.map((a) => [a.name.toLowerCase(), a.isDormant]));

    // Concierge: one row per live account, merged when several accounts share a study.
    const concierge: Row[] = [];
    const seen = new Map<string, Extract<Row, { kind: 'study' }>>();
    for (const a of [...accounts].sort((x, y) => x.name.localeCompare(y.name))) {
      const s = byAccount.get(a.name.toLowerCase());
      if (!s) {
        concierge.push({ kind: 'missing', key: `acct:${a.id}`, accountName: a.name, industry: a.industry, dormant: a.isDormant });
        continue;
      }
      const existing = seen.get(s.id);
      if (existing) {
        existing.accounts.push(a.name);
        if (!a.isDormant) existing.dormant = false;
        continue;
      }
      const row = { kind: 'study' as const, key: s.id, study: s, accounts: [a.name], dormant: a.isDormant };
      seen.set(s.id, row);
      concierge.push(row);
    }
    // Before the accounts load (or if the list is empty), fall back to tagged studies.
    if (accounts.length === 0) {
      for (const s of CASE_STUDIES.filter((c) => c.tracks.includes('concierge'))) {
        concierge.push({ kind: 'study', key: s.id, study: s, accounts: [], dormant: null });
      }
    }

    const fromData = (t: CaseStudyTrack): Row[] => CASE_STUDIES
      .filter((s) => s.tracks.includes(t))
      .map((s) => {
        const accts = [s.accountName, ...(s.alsoAccounts ?? [])].filter((n): n is string => !!n && dormantByName.has(n.toLowerCase()));
        const dormant = accts.length ? accts.every((n) => dormantByName.get(n.toLowerCase())) : null;
        return { kind: 'study' as const, key: s.id, study: s, accounts: accts, dormant };
      })
      .sort((a, b) => (completeness(b.study) - completeness(a.study)) || a.study.client.localeCompare(b.study.client));

    return { ai: fromData('ai'), concierge, implementation: fromData('implementation') } as Record<CaseStudyTrack, Row[]>;
  }, [accounts]);

  const rows = rowsByTrack[track];
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) => {
        const hay = r.kind === 'missing'
          ? `${r.accountName} ${r.industry ?? ''}`
          : [r.study.client, r.study.industry, r.study.summary, ...r.study.salesforce, ...r.study.stack, ...r.accounts].join(' ');
        return hay.toLowerCase().includes(needle);
      })
    : rows;

  const studies = rows.filter((r): r is Extract<Row, { kind: 'study' }> => r.kind === 'study');
  const complete = studies.filter((r) => completeness(r.study) === MAX).length;
  const drafts = studies.filter((r) => r.study.source === 'profile').length;
  const missing = rows.filter((r) => r.kind === 'missing').length;

  // Salesforce product coverage across this view.
  const products = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of studies) for (const p of new Set(r.study.salesforce)) counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [studies]);
  const topCount = products[0]?.[1] ?? 1;

  const openRow = studies.find((r) => r.key === openKey) ?? null;

  return (
    <div className="space-y-6">
      {/* View switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-surface border border-line rounded-lg p-1 w-fit">
          {TRACKS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTrack(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 transition-colors ${
                track === t.key ? 'bg-navy text-white' : 'text-muted hover:bg-surface-2'
              }`}
            >
              {t.icon} {TRACK_LABEL[t.key]}
              <span className={`text-[11px] tabular-nums ${track === t.key ? 'text-white/70' : 'text-muted/70'}`}>{rowsByTrack[t.key].length}</span>
            </button>
          ))}
        </div>
        <label className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search client, industry, product…"
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-line bg-surface w-72 max-w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </label>
      </div>

      {/* Scorecard KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label={track === 'concierge' ? 'Concierge clients' : 'Case studies'} value={rows.length} subtitle={track === 'concierge' && accounts.length ? `${accounts.length} accounts · shared studies merged` : TRACK_LABEL[track]} icon={<Layers size={20} />} tone="navy" />
        <StatCard label="Complete" value={complete} subtitle={`All ${MAX} fields filled`} icon={<CheckCircle2 size={20} />} tone="green" />
        <StatCard label="Drafts to review" value={drafts} subtitle="From account profiles" icon={<PenLine size={20} />} tone="gold" />
        <StatCard label="Not written" value={missing} subtitle={track === 'concierge' ? 'Concierge accounts with no study' : '—'} icon={<CircleDashed size={20} />} tone="rose" />
      </div>

      {/* Product coverage */}
      {products.length > 0 && (
        <div className="bg-surface rounded-2xl border border-line/70 p-5">
          <p className="eyebrow mb-3">Salesforce products in use · {TRACK_LABEL[track]}</p>
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2">
            {products.map(([p, n]) => (
              <button key={p} type="button" onClick={() => setQ(p)} className="flex items-center gap-3 text-left group" title={`Show clients using ${p}`}>
                <span className="text-sm text-ink/80 w-44 truncate group-hover:text-brand">{p}</span>
                <span className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
                  <span className="block h-full bg-brand rounded-full" style={{ width: `${(n / topCount) * 100}%` }} />
                </span>
                <span className="text-xs text-muted tabular-nums w-6 text-right">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cards */}
      {visible.length === 0 ? (
        <p className="text-sm text-muted">No matches{needle ? ` for “${q}”` : ''}.</p>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {visible.map((r) => r.kind === 'study'
            ? <StudyCard key={r.key} row={r} onOpen={() => setOpenKey(r.key)} />
            : <MissingCard key={r.key} row={r} />)}
        </div>
      )}

      <p className="text-xs text-muted">
        Source: Case Studies Updated 2026 deck; drafts from Concierge account profiles. Edit <code>src/data/caseStudies.ts</code> to add or update a client.
      </p>

      <StudyDrawer row={openRow} onClose={() => setOpenKey(null)} />
    </div>
  );
}
