/**
 * Leave admin — allocations, types, bulk import, audit trail.
 *
 * Four tabs:
 *   1. Allocations — grid (employee × leave type) for the selected year.
 *      Inline-editable cells; blank means "fall back to leave_types.annual_quota".
 *   2. Bulk Import — paste CSV (email,type_code,year,quota[,carried_forward])
 *      or upload a .csv file. Dry-run preview shows +N inserts / M updates /
 *      K skipped-because-unchanged before applying.
 *   3. Leave Types — edit the annual quota / color / active state on each
 *      seeded type (Casual, Sick, Earned, …) and add new ones.
 *   4. Audit — the immutable audit trail across all three tables, filtered
 *      by entity + actor + date.
 *
 * RLS: leave_allocations write policy already restricts to admins; this
 * page is additionally gated by AdminOnly on the router.
 */
import { useMemo, useState, useEffect } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import {
  Users as UsersIcon, Upload, Palette, History, Save, Trash2, Plus,
  Download, AlertCircle, CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useLeaveStore } from '../../store/useLeaveStore';
import { useAuthStore } from '../../store/useAuthStore';
import { fetchLeaveAudit } from '../../lib/supabaseSync';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, Button, Badge } from '../../components/ui';
import { isTypeVisibleTo } from '../../types/leave';
import type { LeaveType, LeaveAllocation, LeaveAuditEntry, AllocationSource } from '../../types/leave';

const INPUT_CLS = 'w-full px-2 py-1 rounded border border-line text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`${INPUT_CLS} ${className}`} {...p} />;
const Select = ({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={`${INPUT_CLS} bg-white ${className}`} {...p}>{children}</select>;
const Textarea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={`${INPUT_CLS} font-mono text-xs ${className}`} {...p} />;

// Swatch + hex input, shared by the leave-type add form and inline row editor.
const ColorField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="flex items-center gap-1">
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-8 h-8 rounded border border-line cursor-pointer shrink-0"
    />
    <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono text-xs" />
  </div>
);

type Tab = 'allocations' | 'import' | 'types' | 'audit';

export default function LeaveAdminPage() {
  const [tab, setTab] = useState<Tab>('allocations');
  const { types, allocations, requests } = useLeaveStore();
  const [year, setYear] = useState<number>(new Date().getFullYear());

  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <div>
      <PageHeader
        title="Leave Administration"
        subtitle="Set per-employee allocations, import from Zoho, and view the audit trail."
        action={
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">Year</label>
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24">
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
        }
      />

      <div className="flex gap-1 bg-white border border-line rounded-lg p-1 mb-6 w-fit">
        {([
          { key: 'allocations', label: 'Allocations', icon: UsersIcon },
          { key: 'import',      label: 'Bulk Import', icon: Upload },
          { key: 'types',       label: 'Leave Types', icon: Palette },
          { key: 'audit',       label: 'Audit Trail', icon: History },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${
              tab === t.key ? 'bg-primary text-white' : 'text-muted hover:bg-surface-2'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'allocations' && <AllocationsTab year={year} types={types} allocations={allocations} requests={requests} />}
      {tab === 'import'      && <BulkImportTab year={year} types={types} />}
      {tab === 'types'       && <LeaveTypesTab types={types} />}
      {tab === 'audit'       && <AuditTab />}
    </div>
  );
}

/* ── Tab 1: Allocations grid ─────────────────────────────────────────── */

function AllocationsTab({
  year, types, allocations, requests,
}: {
  year: number;
  types: LeaveType[];
  allocations: LeaveAllocation[];
  requests: import('../../types/leave').LeaveRequest[];
}) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const directory = useAuthStore((s) => s.directory);
  const { upsertAllocation } = useLeaveStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [employees, setEmployees] = useState<Array<{ email: string; fullName: string | null; gender: string | null }>>([]);

  useEffect(() => {
    // Prefer the auth store's directory (already hydrated on init). Fall back
    // to a live fetch if empty (fresh session before loadDirectory ran).
    // `gender` is carried so gendered leave types (MAT/PAT) only allocate to
    // matching employees.
    const dirEmails = Object.keys(directory);
    if (dirEmails.length > 0) {
      setEmployees(dirEmails.map((k) => ({ email: k, fullName: directory[k].fullName, gender: directory[k].gender })).sort(
        (a, b) => (a.fullName || a.email).localeCompare(b.fullName || b.email),
      ));
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from('authorized_users')
        .select('email, full_name, gender, active')
        .order('full_name', { ascending: true });
      if (data) setEmployees((data as { email: string; full_name: string | null; gender: string | null; active: boolean }[])
        .filter((r) => r.active !== false)
        .map((r) => ({ email: r.email, fullName: r.full_name, gender: r.gender })));
    })();
  }, [directory]);

  const activeTypes = types.filter((t) => t.active);

  const allocByKey = useMemo(() => {
    const m = new Map<string, LeaveAllocation>();
    for (const a of allocations) {
      if (a.year === year) m.set(`${a.employeeEmail.toLowerCase()}|${a.leaveTypeId}`, a);
    }
    return m;
  }, [allocations, year]);

  const usedByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of requests) {
      if (r.status !== 'approved') continue;
      if (new Date(r.startDate).getUTCFullYear() !== year) continue;
      const k = `${r.employeeEmail.toLowerCase()}|${r.leaveTypeId}`;
      m.set(k, (m.get(k) || 0) + r.days);
    }
    return m;
  }, [requests, year]);

  const filtered = employees.filter((e) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return e.email.toLowerCase().includes(q) || (e.fullName || '').toLowerCase().includes(q);
  });

  const commit = async (email: string, leaveType: LeaveType, quotaStr: string, carriedStr: string) => {
    if (!currentUser) return;
    const quota = Number(quotaStr);
    const carried = Number(carriedStr) || 0;
    if (!Number.isFinite(quota) || quota < 0) return;
    const key = `${email.toLowerCase()}|${leaveType.id}`;
    const existing = allocByKey.get(key);
    if (existing && existing.quota === quota && existing.carriedForward === carried) return;
    setBusy(key);
    try {
      await upsertAllocation({
        id: existing?.id || crypto.randomUUID(),
        employeeEmail: email.toLowerCase(),
        leaveTypeId: leaveType.id,
        year,
        quota,
        carriedForward: carried,
        source: 'admin',
        notes: existing?.notes ?? null,
        createdBy: existing?.createdBy ?? currentUser.email,
        updatedBy: currentUser.email,
      }, currentUser.email);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search employee…" className="max-w-sm" />
        <span className="text-xs text-muted ml-auto">{filtered.length} of {employees.length} employees · {allocByKey.size} allocations for {year}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line/60">
              <th className="text-left p-2 sticky left-0 bg-white text-muted/70 font-bold uppercase tracking-wide text-[10px]">Employee</th>
              {activeTypes.map((t) => (
                <th key={t.id} className="p-2 text-muted/70 font-bold uppercase tracking-wide text-[10px] whitespace-nowrap">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                    style={{ background: t.color, color: 'white' }}
                  >
                    {t.code}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => (
              <tr key={emp.email} className="border-b border-line/40 hover:bg-surface-2/50">
                <td className="p-2 sticky left-0 bg-white">
                  <div className="font-medium text-ink">{emp.fullName || emp.email.split('@')[0]}</div>
                  <div className="text-[10px] text-muted">{emp.email}</div>
                </td>
                {activeTypes.map((t) => {
                  // Gendered types (MAT/PAT) aren't allocatable to employees who
                  // don't match — render a muted placeholder so columns stay aligned.
                  if (!isTypeVisibleTo(t, emp.gender)) {
                    return (
                      <td key={t.id} className="p-1 align-top text-center">
                        <span className="text-line text-xs" title={`Not applicable — ${t.name} is ${t.eligibility}-only`}>—</span>
                      </td>
                    );
                  }
                  const key = `${emp.email.toLowerCase()}|${t.id}`;
                  const a = allocByKey.get(key);
                  const used = usedByKey.get(key) || 0;
                  const isBusy = busy === key;
                  return (
                    <td key={t.id} className="p-1 align-top">
                      <AllocationCell
                        alloc={a}
                        fallback={t.annualQuota}
                        used={used}
                        busy={isBusy}
                        onCommit={(q, c) => commit(emp.email, t, q, c)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AllocationCell({
  alloc, fallback, used, busy, onCommit,
}: {
  alloc?: LeaveAllocation;
  fallback: number;
  used: number;
  busy: boolean;
  onCommit: (quotaStr: string, carriedStr: string) => void;
}) {
  const [quotaStr, setQuotaStr] = useState<string>(alloc ? String(alloc.quota) : '');
  const [carriedStr, setCarriedStr] = useState<string>(alloc ? String(alloc.carriedForward) : '');

  useEffect(() => {
    setQuotaStr(alloc ? String(alloc.quota) : '');
    setCarriedStr(alloc ? String(alloc.carriedForward) : '');
  }, [alloc?.quota, alloc?.carriedForward]);

  const effective = (alloc ? alloc.quota + alloc.carriedForward : fallback);
  const remaining = Math.max(0, effective - used);
  const hasAlloc = !!alloc;

  return (
    <div className={`rounded border p-1 min-w-[130px] ${hasAlloc ? 'border-primary/30 bg-primary/5' : 'border-line bg-white'}`}>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={quotaStr}
          onChange={(e) => setQuotaStr(e.target.value)}
          onBlur={() => onCommit(quotaStr, carriedStr)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder={String(fallback)}
          className="w-14 px-1 py-0.5 text-xs text-center rounded border border-line focus:outline-none focus:ring-1 focus:ring-primary/50"
          disabled={busy}
        />
        <span className="text-[10px] text-muted">+</span>
        <input
          type="number"
          value={carriedStr}
          onChange={(e) => setCarriedStr(e.target.value)}
          onBlur={() => onCommit(quotaStr, carriedStr)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="cf"
          title="Carried forward from prior year"
          className="w-10 px-1 py-0.5 text-xs text-center rounded border border-line focus:outline-none focus:ring-1 focus:ring-primary/50"
          disabled={busy}
        />
      </div>
      <div className="text-[10px] text-muted mt-0.5 flex items-center gap-1 whitespace-nowrap">
        {busy ? <Loader2 size={9} className="animate-spin" /> : hasAlloc ? <CheckCircle2 size={9} className="text-primary" /> : null}
        <span>{used}u · {remaining}r</span>
        {!hasAlloc && (
          <span className="text-muted/70 italic" title={`Uses type default of ${fallback} days`}>(default)</span>
        )}
      </div>
    </div>
  );
}

/* ── Tab 2: Bulk import ─────────────────────────────────────────────── */

interface ImportRow {
  employeeEmail: string;
  leaveTypeCode: string;
  quota: number;
  carriedForward: number;
  matched: {
    typeId: string | null;
    employeeKnown: boolean;
    existing: LeaveAllocation | undefined;
  };
  error?: string;
}

function BulkImportTab({ year, types }: { year: number; types: LeaveType[] }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const directory = useAuthStore((s) => s.directory);
  const { bulkUpsertAllocations, allocations } = useLeaveStore();
  const [raw, setRaw] = useState('');
  const [source, setSource] = useState<AllocationSource>('zoho_import');
  const [parsedRows, setParsedRows] = useState<ImportRow[]>([]);
  const [result, setResult] = useState<{ ok: number; failed: number; error?: string } | null>(null);
  const [applying, setApplying] = useState(false);

  const parse = () => {
    setResult(null);
    const typeByCode = new Map(types.map((t) => [t.code.toUpperCase(), t]));
    const dirEmails = new Set(Object.keys(directory));
    const rows: ImportRow[] = [];
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // skip a header row if one is present
      if (/^email/i.test(line)) continue;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length < 3) {
        rows.push({ employeeEmail: line, leaveTypeCode: '', quota: 0, carriedForward: 0,
          matched: { typeId: null, employeeKnown: false, existing: undefined },
          error: 'need at least 3 fields: email,type_code,quota' });
        continue;
      }
      const [emailRaw, codeRaw, quotaRaw, cfRaw] = parts;
      const email = emailRaw.toLowerCase();
      const code = codeRaw.toUpperCase();
      const quota = Number(quotaRaw);
      const cf = cfRaw !== undefined && cfRaw !== '' ? Number(cfRaw) : 0;
      const type = typeByCode.get(code) || null;
      const existing = allocations.find(
        (a) => a.employeeEmail.toLowerCase() === email && a.leaveTypeId === type?.id && a.year === year,
      );
      const err =
        !Number.isFinite(quota) || quota < 0 ? 'quota must be a non-negative number'
          : !type ? `unknown leave type "${code}"`
          : !dirEmails.has(email) ? `email not in authorized_users`
          : undefined;
      rows.push({
        employeeEmail: email,
        leaveTypeCode: code,
        quota,
        carriedForward: cf,
        matched: { typeId: type?.id || null, employeeKnown: dirEmails.has(email), existing },
        error: err,
      });
    }
    setParsedRows(rows);
  };

  const validRows = parsedRows.filter((r) => !r.error);
  const insertCount = validRows.filter((r) => !r.matched.existing).length;
  const updateCount = validRows.filter((r) => r.matched.existing).length;
  const errorCount = parsedRows.filter((r) => !!r.error).length;

  // Rows whose type_code isn't in the catalog are dropped from the import.
  // Surface the distinct unmapped codes prominently so they don't vanish silently.
  const unmappedRows = parsedRows.filter((r) => !r.matched.typeId && r.leaveTypeCode);
  const unmappedCodes = [...new Set(unmappedRows.map((r) => r.leaveTypeCode))];

  const apply = async () => {
    if (!currentUser || validRows.length === 0) return;
    setApplying(true);
    setResult(null);
    try {
      const payload = validRows.map((r) => ({
        employeeEmail: r.employeeEmail,
        leaveTypeId: r.matched.typeId!,
        year,
        quota: r.quota,
        carriedForward: r.carriedForward,
        source,
        notes: null,
      }));
      const res = await bulkUpsertAllocations(payload, currentUser.email, source);
      setResult(res);
      if (res.failed === 0) setParsedRows([]);
    } finally {
      setApplying(false);
    }
  };

  const sample = `# CSV: email,leave_type_code,quota[,carried_forward]
# type codes: ${types.map((t) => t.code).join(', ')}
raghu.seetharam@simpliigence.com,EL,20,2
raghu.seetharam@simpliigence.com,SL,10,0
raghu.seetharam@simpliigence.com,CL,12,3`;

  return (
    <Card>
      <div className="flex items-center gap-4 mb-3">
        <div className="text-sm font-semibold text-ink">Paste rows to import into <strong>{year}</strong></div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">Source</label>
          <Select value={source} onChange={(e) => setSource(e.target.value as AllocationSource)} className="w-40">
            <option value="zoho_import">Zoho migration</option>
            <option value="csv_import">CSV import</option>
            <option value="admin">Admin adjustment</option>
            <option value="rollover">Year-end rollover</option>
          </Select>
        </div>
      </div>
      <Textarea
        rows={12}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={sample}
        className="mb-3"
      />
      {unmappedCodes.length > 0 && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
          <div>
            <p className="font-semibold">
              {unmappedRows.length} row{unmappedRows.length === 1 ? '' : 's'} will be skipped — unknown leave type{unmappedCodes.length === 1 ? '' : 's'}:{' '}
              {unmappedCodes.map((c) => (
                <span key={c} className="inline-block font-mono font-bold bg-amber-100 border border-amber-300 rounded px-1 mr-1">{c}</span>
              ))}
            </p>
            <p className="mt-1 text-amber-800">
              These codes aren't in the leave-type catalog, so their rows won't import. Add each one in the{' '}
              <strong>Leave Types</strong> tab (matching the exact code above), then re-run the preview.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={parse} disabled={!raw.trim()}>
          <RefreshCw size={14} /> Preview
        </Button>
        <Button onClick={apply} disabled={validRows.length === 0 || applying}>
          {applying ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {applying ? 'Applying…' : `Apply ${validRows.length} row${validRows.length === 1 ? '' : 's'}`}
        </Button>
        <button
          type="button"
          onClick={() => { setRaw(sample); setParsedRows([]); setResult(null); }}
          className="text-xs text-muted hover:text-ink/80 ml-2"
        >
          Load sample
        </button>
        <div className="ml-auto text-xs text-muted flex items-center gap-3">
          {insertCount > 0 && <span className="text-emerald-700">+{insertCount} new</span>}
          {updateCount > 0 && <span className="text-sky-700">{updateCount} update</span>}
          {errorCount > 0 && <span className="text-rose-700">{errorCount} error</span>}
        </div>
      </div>

      {result && (
        <div className={`mt-3 rounded-md border p-2 text-xs flex items-start gap-2 ${
          result.failed === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          {result.failed === 0 ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          <span>
            {result.failed === 0
              ? `Imported ${result.ok} allocation${result.ok === 1 ? '' : 's'} for ${year}.`
              : `Failed: ${result.error || 'unknown error'}`}
          </span>
        </div>
      )}

      {parsedRows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line/60 text-left">
                <th className="p-2 font-semibold text-muted uppercase text-[10px]">Employee</th>
                <th className="p-2 font-semibold text-muted uppercase text-[10px]">Type</th>
                <th className="p-2 font-semibold text-muted uppercase text-[10px]">Quota</th>
                <th className="p-2 font-semibold text-muted uppercase text-[10px]">Carry-forward</th>
                <th className="p-2 font-semibold text-muted uppercase text-[10px]">Diff</th>
                <th className="p-2 font-semibold text-muted uppercase text-[10px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {parsedRows.map((r, i) => {
                const type = types.find((t) => t.id === r.matched.typeId);
                const existing = r.matched.existing;
                const diff = existing
                  ? (existing.quota !== r.quota || existing.carriedForward !== r.carriedForward
                      ? `${existing.quota}+${existing.carriedForward} → ${r.quota}+${r.carriedForward}`
                      : 'no change')
                  : 'new';
                return (
                  <tr key={i} className="border-b border-line/40">
                    <td className="p-2">{r.employeeEmail}</td>
                    <td className="p-2">
                      {type ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: type.color }}>
                          {type.code}
                        </span>
                      ) : r.leaveTypeCode}
                    </td>
                    <td className="p-2 font-medium">{r.quota}</td>
                    <td className="p-2 text-muted">{r.carriedForward}</td>
                    <td className="p-2 text-muted">{diff}</td>
                    <td className="p-2">
                      {r.error ? (
                        <span title={r.error}><Badge className="bg-rose-100 text-rose-800">{r.error}</Badge></span>
                      ) : existing ? (
                        <Badge className="bg-sky-100 text-sky-800">Update</Badge>
                      ) : (
                        <Badge className="bg-emerald-100 text-emerald-800">Insert</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ── Tab 3: Leave types editor ──────────────────────────────────────── */

function LeaveTypesTab({ types }: { types: LeaveType[] }) {
  const { upsertType, removeType } = useLeaveStore();
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs text-muted max-w-2xl">
          These are the default annual quotas applied when an employee has no allocation row for the year.
          Once you've imported per-employee allocations, these defaults only matter for new joiners without a row.
        </p>
        <Button size="sm" variant="secondary" onClick={() => setAdding((v) => !v)}>
          <Plus size={14} /> Add leave type
        </Button>
      </div>
      {adding && (
        <AddLeaveTypeForm
          existing={types}
          onCancel={() => setAdding(false)}
          onCreate={async (t) => { await upsertType(t); setAdding(false); }}
        />
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line/60 text-left">
            <th className="p-2 text-xs font-semibold text-muted uppercase tracking-wide">Name</th>
            <th className="p-2 text-xs font-semibold text-muted uppercase tracking-wide">Code</th>
            <th className="p-2 text-xs font-semibold text-muted uppercase tracking-wide">Default Quota</th>
            <th className="p-2 text-xs font-semibold text-muted uppercase tracking-wide">Color</th>
            <th className="p-2 text-xs font-semibold text-muted uppercase tracking-wide">Eligibility</th>
            <th className="p-2 text-xs font-semibold text-muted uppercase tracking-wide">Active</th>
            <th className="p-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {[...types].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => (
            <LeaveTypeRow key={t.id} type={t} onSave={upsertType} onDelete={removeType} />
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function AddLeaveTypeForm({
  existing, onCreate, onCancel,
}: {
  existing: LeaveType[];
  onCreate: (t: LeaveType) => Promise<void>;
  onCancel: () => void;
}) {
  const nextSort = existing.reduce((m, t) => Math.max(m, t.sortOrder), 0) + 10;
  const [draft, setDraft] = useState<LeaveType>({
    id: nanoid(),
    name: '',
    code: '',
    annualQuota: 0,
    color: '#64748b',
    active: true,
    sortOrder: nextSort,
    eligibility: 'all',
  });
  const [saving, setSaving] = useState(false);

  const name = draft.name.trim();
  const code = draft.code.trim().toUpperCase();
  const error =
    !name ? 'Name is required'
      : !code ? 'Code is required'
      : existing.some((t) => t.code.toUpperCase() === code) ? `Code "${code}" is already in use`
      : null;

  const save = async () => {
    if (error) return;
    setSaving(true);
    try {
      await onCreate({ ...draft, name, code });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
        <label className="text-xs text-muted">
          <span className="block mb-1 font-medium">Name</span>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Annual Leave" autoFocus />
        </label>
        <label className="text-xs text-muted">
          <span className="block mb-1 font-medium">Code</span>
          <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} placeholder="AL" className="uppercase" />
        </label>
        <label className="text-xs text-muted">
          <span className="block mb-1 font-medium">Default quota</span>
          <Input type="number" value={draft.annualQuota} onChange={(e) => setDraft({ ...draft, annualQuota: Number(e.target.value) })} />
        </label>
        <label className="text-xs text-muted">
          <span className="block mb-1 font-medium">Sort order</span>
          <Input type="number" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })} />
        </label>
        <label className="text-xs text-muted">
          <span className="block mb-1 font-medium">Color</span>
          <ColorField value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
        </label>
        <label className="text-xs text-muted">
          <span className="block mb-1 font-medium">Eligibility</span>
          <Select value={draft.eligibility} onChange={(e) => setDraft({ ...draft, eligibility: e.target.value as LeaveType['eligibility'] })}>
            <option value="all">Everyone</option>
            <option value="female">Female only</option>
            <option value="male">Male only</option>
          </Select>
        </label>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-muted">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          Active
        </label>
        {error && <span className="text-xs text-rose-600">{error}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={!!error || saving}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create type
          </Button>
        </div>
      </div>
    </div>
  );
}

function LeaveTypeRow({
  type, onSave, onDelete,
}: {
  type: LeaveType;
  onSave: (t: LeaveType) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LeaveType>(type);
  useEffect(() => setDraft(type), [type.id, type.updatedAt]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(type);
  return (
    <tr className="border-b border-line/40">
      <td className="p-2">
        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </td>
      <td className="p-2 w-20">
        <Input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} className="uppercase" />
      </td>
      <td className="p-2 w-32">
        <Input type="number" value={draft.annualQuota} onChange={(e) => setDraft({ ...draft, annualQuota: Number(e.target.value) })} />
      </td>
      <td className="p-2 w-32">
        <ColorField value={draft.color} onChange={(color) => setDraft({ ...draft, color })} />
      </td>
      <td className="p-2 w-32">
        <Select value={draft.eligibility} onChange={(e) => setDraft({ ...draft, eligibility: e.target.value as LeaveType['eligibility'] })}>
          <option value="all">Everyone</option>
          <option value="female">Female only</option>
          <option value="male">Male only</option>
        </Select>
      </td>
      <td className="p-2">
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-xs">{draft.active ? 'Yes' : 'No'}</span>
        </label>
      </td>
      <td className="p-2 whitespace-nowrap">
        {dirty && (
          <Button size="sm" onClick={() => onSave(draft)}>
            <Save size={12} /> Save
          </Button>
        )}
        <button
          type="button"
          onClick={() => confirm(`Delete "${type.name}"? Existing allocations + requests will remain, but no new ones can be created.`) && onDelete(type.id)}
          className="text-muted/70 hover:text-rose-600 ml-1 p-1"
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

/* ── Tab 4: Audit trail ─────────────────────────────────────────────── */

function AuditTab() {
  const [entries, setEntries] = useState<LeaveAuditEntry[] | null>(null);
  const [filterEntity, setFilterEntity] = useState<string>('');
  const [filterActor, setFilterActor] = useState('');

  const load = async () => {
    const data = await fetchLeaveAudit({ limit: 500, entity: filterEntity || undefined });
    setEntries(data);
  };

  useEffect(() => { void load(); }, [filterEntity]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = (entries || []).filter((e) => {
    if (!filterActor.trim()) return true;
    return (e.actorEmail || '').toLowerCase().includes(filterActor.toLowerCase());
  });

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className="w-48">
          <option value="">All entities</option>
          <option value="leave_types">Leave types</option>
          <option value="leave_allocations">Allocations</option>
          <option value="leave_requests">Requests</option>
        </Select>
        <Input value={filterActor} onChange={(e) => setFilterActor(e.target.value)} placeholder="Filter by actor email…" className="max-w-sm" />
        <button type="button" onClick={load} className="text-xs text-muted hover:text-ink/80 flex items-center gap-1">
          <RefreshCw size={12} /> Reload
        </button>
        <span className="ml-auto text-xs text-muted">{visible.length} entries</span>
      </div>
      {entries === null ? (
        <p className="text-center text-muted/70 py-6 text-sm"><Loader2 size={14} className="animate-spin inline mr-1" /> Loading audit trail…</p>
      ) : visible.length === 0 ? (
        <p className="text-center text-muted/70 py-6 text-sm">No audit entries match the filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line/60 text-left">
                <th className="p-2 text-muted/70 font-bold uppercase tracking-wide text-[10px]">When</th>
                <th className="p-2 text-muted/70 font-bold uppercase tracking-wide text-[10px]">Actor</th>
                <th className="p-2 text-muted/70 font-bold uppercase tracking-wide text-[10px]">Entity</th>
                <th className="p-2 text-muted/70 font-bold uppercase tracking-wide text-[10px]">Action</th>
                <th className="p-2 text-muted/70 font-bold uppercase tracking-wide text-[10px]">Summary</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="border-b border-line/40 align-top">
                  <td className="p-2 text-muted whitespace-nowrap">{new Date(e.changedAt).toLocaleString()}</td>
                  <td className="p-2 text-ink/80 whitespace-nowrap">{e.actorEmail || <span className="italic text-muted/70">system</span>}</td>
                  <td className="p-2 text-muted whitespace-nowrap">{e.entity.replace('leave_', '')}</td>
                  <td className="p-2">
                    <Badge className={
                      e.action === 'INSERT' ? 'bg-emerald-100 text-emerald-800'
                        : e.action === 'UPDATE' ? 'bg-sky-100 text-sky-800'
                        : 'bg-rose-100 text-rose-800'
                    }>{e.action}</Badge>
                  </td>
                  <td className="p-2 text-ink/80">
                    <AuditSummary entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AuditSummary({ entry }: { entry: LeaveAuditEntry }) {
  const before = entry.beforeData || {};
  const after = entry.afterData || {};

  if (entry.entity === 'leave_requests') {
    const employee = (after.employee_email || before.employee_email || '') as string;
    const status = (after.status || before.status) as string;
    const range = `${(after.start_date || before.start_date)} → ${(after.end_date || before.end_date)}`;
    const days = String(after.days || before.days);
    if (entry.action === 'UPDATE' && before.status !== after.status) {
      return <span><strong>{employee}</strong> · {days}d · <span className="text-muted">{before.status as string} → </span><span className="font-semibold">{after.status as string}</span></span>;
    }
    return <span><strong>{employee}</strong> · {days}d · {range} · {status}</span>;
  }

  if (entry.entity === 'leave_allocations') {
    const employee = (after.employee_email || before.employee_email || '') as string;
    const year = (after.year || before.year) as number;
    const type = (after.leave_type_id || before.leave_type_id) as string;
    if (entry.action === 'UPDATE') {
      const bq = `${before.quota}+${before.carried_forward}`;
      const aq = `${after.quota}+${after.carried_forward}`;
      return <span><strong>{employee}</strong> · {type} · {year} · <span className="text-muted">{bq} → </span><span className="font-semibold">{aq}</span></span>;
    }
    return <span><strong>{employee}</strong> · {type} · {year} · {after.quota as number}+{after.carried_forward as number} · <span className="text-muted/70">{(after.source || 'admin') as string}</span></span>;
  }

  if (entry.entity === 'leave_types') {
    const name = (after.name || before.name) as string;
    return <span><strong>{name}</strong> ({(after.code || before.code) as string}) · quota {(after.annual_quota || before.annual_quota) as number}</span>;
  }

  return <code className="text-[10px] text-muted">{JSON.stringify({ before, after }).slice(0, 200)}</code>;
}

/* Unused Download import silenced — leaving it in case the file gains an
 * "export CSV" button in the next iteration. */
void Download;
