/**
 * Admin → Audit Log. Filterable view of every change to business data, with
 * an old-vs-new diff drawer. Rows come from the `audit_log` table (populated
 * by Postgres triggers on every tracked table).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, Badge, Drawer } from '../../components/ui';
import { supabase } from '../../lib/supabase';

interface AuditRow {
  id: number;
  ts: string;
  user_id: string | null;
  user_email: string | null;
  table_name: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
}

const RANGE_OPTIONS = [
  { key: '1', label: 'Last 24h', hours: 24 },
  { key: '7', label: 'Last 7d', hours: 24 * 7 },
  { key: '30', label: 'Last 30d', hours: 24 * 30 },
  { key: '0', label: 'All', hours: 0 },
] as const;

const OP_VARIANT: Record<AuditRow['op'], 'info' | 'success' | 'danger'> = {
  INSERT: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
};

export default function AuditLogPage() {
  const [rangeHours, setRangeHours] = useState<number>(24 * 7);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableFilter, setTableFilter] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('');
  const [opFilter, setOpFilter] = useState<'' | AuditRow['op']>('');
  const [search, setSearch] = useState('');
  const [openRow, setOpenRow] = useState<AuditRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('audit_log')
      .select('*')
      .order('ts', { ascending: false })
      .limit(2000);
    if (rangeHours > 0) {
      const since = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();
      q = q.gte('ts', since);
    }
    const { data } = await q;
    setRows((data as AuditRow[]) ?? []);
    setLoading(false);
  }, [rangeHours]);

  useEffect(() => { void refresh(); }, [refresh]);

  const tables = useMemo(() => [...new Set(rows.map((r) => r.table_name))].sort(), [rows]);
  const users = useMemo(() => [...new Set(rows.map((r) => r.user_email).filter(Boolean) as string[])].sort(), [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tableFilter && r.table_name !== tableFilter) return false;
      if (userFilter && r.user_email !== userFilter) return false;
      if (opFilter && r.op !== opFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(r.record_id?.toLowerCase().includes(q)
            || r.user_email?.toLowerCase().includes(q)
            || r.table_name.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [rows, tableFilter, userFilter, opFilter, search]);

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Every change to business data, with who did it and what changed." />

      <Card>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRangeHours(opt.hours)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                rangeHours === opt.hours
                  ? 'bg-primary/10 border-primary/40 text-primary font-semibold'
                  : 'bg-surface border-line text-muted hover:bg-surface-2/70'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <div className="flex-1 min-w-[180px] relative">
            <Search size={14} className="absolute left-2.5 top-2 text-muted/70" />
            <input
              type="text"
              placeholder="Search by record id / user / table…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-line pl-8 pr-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-xs">
            <option value="">All tables</option>
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-xs">
            <option value="">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={opFilter} onChange={(e) => setOpFilter(e.target.value as '' | AuditRow['op'])} className="rounded-lg border border-line px-2 py-1 text-xs">
            <option value="">All ops</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>

        <p className="text-xs text-muted/70 mb-3">
          Showing <strong>{filtered.length.toLocaleString()}</strong> of {rows.length.toLocaleString()} loaded changes. Click any row to see the old → new diff.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left sticky top-0 bg-surface">
                <th className="pb-2 pr-3 font-semibold text-muted">When</th>
                <th className="pb-2 pr-3 font-semibold text-muted">Who</th>
                <th className="pb-2 pr-3 font-semibold text-muted">Table</th>
                <th className="pb-2 pr-3 font-semibold text-muted">Op</th>
                <th className="pb-2 pr-3 font-semibold text-muted">Record</th>
                <th className="pb-2 pr-3 font-semibold text-muted">Changed</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="py-8 text-center text-muted/70 text-sm">Loading…</td></tr>}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="py-8 text-center text-muted/70 text-sm">No changes match the current filters.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setOpenRow(r)} className="border-b border-line/60 hover:bg-surface-2/70 cursor-pointer">
                  <td className="py-1.5 pr-3 text-xs text-muted whitespace-nowrap">{new Date(r.ts).toLocaleString()}</td>
                  <td className="py-1.5 pr-3 text-ink/80 text-xs">{r.user_email ?? <em className="text-muted/70">system</em>}</td>
                  <td className="py-1.5 pr-3 text-xs"><code className="bg-surface-2 px-1.5 py-0.5 rounded text-ink/80">{r.table_name}</code></td>
                  <td className="py-1.5 pr-3"><Badge variant={OP_VARIANT[r.op]}>{r.op}</Badge></td>
                  <td className="py-1.5 pr-3 text-xs font-mono text-muted truncate max-w-[220px]">{r.record_id ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-xs text-muted">
                    {r.op === 'UPDATE'
                      ? <span>{(r.changed_fields ?? []).length} field{(r.changed_fields ?? []).length === 1 ? '' : 's'}: <span className="text-ink/80">{(r.changed_fields ?? []).slice(0, 3).join(', ')}{(r.changed_fields ?? []).length > 3 ? '…' : ''}</span></span>
                      : r.op === 'INSERT' ? <em>new row</em> : <em>row removed</em>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer
        open={!!openRow}
        onClose={() => setOpenRow(null)}
        title={openRow ? `${openRow.op} · ${openRow.table_name}` : ''}
        width="max-w-3xl"
      >
        {openRow && <DiffPanel row={openRow} />}
      </Drawer>
    </>
  );
}

function DiffPanel({ row }: { row: AuditRow }) {
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    if (row.old_data) Object.keys(row.old_data).forEach((k) => set.add(k));
    if (row.new_data) Object.keys(row.new_data).forEach((k) => set.add(k));
    return [...set].sort();
  }, [row]);

  const changedSet = new Set(row.changed_fields ?? []);

  // For UPDATE, only show changed + a few identifying fields. For INSERT/DELETE, show everything.
  const visibleKeys = row.op === 'UPDATE'
    ? allKeys.filter((k) => changedSet.has(k) || k === 'id' || k === 'name' || k === 'employee_name')
    : allKeys;

  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v, null, 2);
    return String(v);
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted space-y-1">
        <div><span className="text-muted/70">When:</span> <span className="text-ink/80">{new Date(row.ts).toLocaleString()}</span></div>
        <div><span className="text-muted/70">Who:</span> <span className="text-ink/80">{row.user_email ?? 'system'}</span></div>
        <div><span className="text-muted/70">Record id:</span> <code className="bg-surface-2 px-1.5 py-0.5 rounded text-ink/80">{row.record_id ?? '—'}</code></div>
        {row.op === 'UPDATE' && row.changed_fields && (
          <div><span className="text-muted/70">Changed fields:</span> <span className="text-ink/80">{row.changed_fields.join(', ')}</span></div>
        )}
      </div>

      <div className="border border-line rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-2/70 text-left">
              <th className="py-2 px-3 font-semibold text-muted uppercase tracking-wider text-[10px]">Field</th>
              <th className="py-2 px-3 font-semibold text-muted uppercase tracking-wider text-[10px]">{row.op === 'INSERT' ? '—' : 'Old'}</th>
              <th className="py-2 px-3 font-semibold text-muted uppercase tracking-wider text-[10px]">{row.op === 'DELETE' ? '—' : 'New'}</th>
            </tr>
          </thead>
          <tbody>
            {visibleKeys.map((k) => {
              const oldVal = row.old_data?.[k];
              const newVal = row.new_data?.[k];
              const changed = changedSet.has(k);
              return (
                <tr key={k} className={`border-t border-line/60 ${changed ? 'bg-amber-50/40' : ''}`}>
                  <td className="py-1.5 px-3 font-mono text-muted">{k}</td>
                  <td className="py-1.5 px-3 text-ink/80">
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug">{row.op === 'INSERT' ? '' : fmt(oldVal)}</pre>
                  </td>
                  <td className="py-1.5 px-3 text-ink/80">
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-snug">{row.op === 'DELETE' ? '' : fmt(newVal)}</pre>
                  </td>
                </tr>
              );
            })}
            {visibleKeys.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-muted/70">No fields to show.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
