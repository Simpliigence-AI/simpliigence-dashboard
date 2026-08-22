import { useMemo } from 'react';
import { Users } from 'lucide-react';
import type { USRosterMember, USRosterAssignment } from '../../types/usRoster';
import {
  US_ROSTER_STATUS_COLORS,
  calcAssignmentMarginPercent,
  calcAssignmentMonthlyRevenue,
} from '../../types/usRoster';
import { Card } from '../../components/ui';
import { Sensitive } from '../../components/Sensitive';
import { useUSRosterStore } from '../../store/useUSRosterStore';

/**
 * "By Client" view.
 *
 * Rows are (consultant, assignment) pairs — not consultants. So the same
 * person appears once under each end-client they're at, with the cost/bill
 * for THAT contract, not a blended average. That matches how the client
 * actually thinks about it: "who's at Pay.UK, and what's each of them
 * costing us there?"
 *
 * Grouping key = `end_client` (fallback: SI, fallback: "(unassigned)").
 */
export function USRosterClientView({ members }: { members: USRosterMember[] }) {
  const allAssignments = useUSRosterStore((s) => s.assignments);

  // Only assignments whose consultant is in the filtered members list.
  const memberById = useMemo(() => {
    const m = new Map<string, USRosterMember>();
    for (const x of members) m.set(x.id, x);
    return m;
  }, [members]);

  const grouped = useMemo(() => {
    // key → { members: [{member, assignment}], counts... }
    const map = new Map<string, { member: USRosterMember; assignment: USRosterAssignment }[]>();
    for (const a of allAssignments) {
      const member = memberById.get(a.roster_id);
      if (!member) continue;
      const key = a.end_client?.trim() || a.si?.trim() || '(unassigned)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ member, assignment: a });
    }
    // Sort within each group by consultant name, then across groups alphabetically.
    return Array.from(map.entries())
      .map(([key, rows]) => {
        rows.sort((a, b) => a.member.name.localeCompare(b.member.name));
        return { key, rows };
      })
      .sort((a, b) => {
        // Put "(unassigned)" last, sort the rest alphabetically.
        if (a.key === '(unassigned)') return 1;
        if (b.key === '(unassigned)') return -1;
        return a.key.localeCompare(b.key);
      });
  }, [allAssignments, memberById]);

  if (grouped.length === 0) {
    return (
      <div className="text-center text-muted py-10 text-sm italic">
        No contracts to show. Switch to Consultant view to add assignments.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(({ key, rows }) => (
        <ClientGroup key={key} clientName={key} rows={rows} />
      ))}
    </div>
  );
}

function ClientGroup({
  clientName, rows,
}: {
  clientName: string;
  rows: { member: USRosterMember; assignment: USRosterAssignment }[];
}) {
  const headcount = rows.length;
  const uniqueSIs = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.assignment.si) s.add(r.assignment.si);
    return Array.from(s).sort();
  }, [rows]);
  const monthlyRev = rows.reduce((s, r) => s + calcAssignmentMonthlyRevenue(r.assignment), 0);
  const totalCost = rows.reduce((s, r) => s + (r.assignment.cost_per_hour || 0) * 160, 0);
  const avgMargin = monthlyRev > 0 ? Math.round(((monthlyRev - totalCost) / monthlyRev) * 100) : 0;

  return (
    <Card className="p-0 overflow-hidden">
      {/* Banner */}
      <div className="px-4 py-3 border-b border-line bg-surface-2/50 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-0.5">End client</div>
          <div className="text-base font-bold text-ink truncate flex items-center gap-2">
            {clientName}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted">
              <Users size={12} /> {headcount}
            </span>
          </div>
          {uniqueSIs.length > 0 && (
            <div className="text-[11px] text-muted mt-0.5 truncate">
              Via {uniqueSIs.join(' · ')}
            </div>
          )}
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Monthly</div>
            <div className="text-sm font-bold text-ink tabular-nums">
              <Sensitive>{`$${(monthlyRev / 1000).toFixed(1)}k`}</Sensitive>
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Avg margin</div>
            <div className="text-sm font-bold text-ink tabular-nums">
              <Sensitive>{`${avgMargin}%`}</Sensitive>
            </div>
          </div>
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-line/60">
        {rows.map(({ member, assignment }) => (
          <ClientRow key={assignment.id} member={member} assignment={assignment} />
        ))}
      </div>
    </Card>
  );
}

function ClientRow({ member, assignment }: { member: USRosterMember; assignment: USRosterAssignment }) {
  const statusColor = US_ROSTER_STATUS_COLORS[member.status] ?? '#94a3b8';
  const rev = calcAssignmentMonthlyRevenue(assignment);
  const marginPct = calcAssignmentMarginPercent(assignment);

  return (
    <div className="grid grid-cols-12 gap-3 items-center px-4 py-2.5 hover:bg-surface-2/30">
      <div className="col-span-3 min-w-0">
        <div className="font-semibold text-sm text-ink truncate">{member.name}</div>
        <div className="text-[11px] text-muted truncate">{member.role || '—'}</div>
      </div>
      <div className="col-span-2">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full"
          style={{ background: `${statusColor}22`, color: statusColor }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
          {member.status}
        </span>
      </div>
      <div className="col-span-2 text-[11px] text-ink/80 min-w-0">
        <div className="uppercase tracking-wide text-[9px] text-muted">SI</div>
        <div className="truncate">{assignment.si || <span className="italic text-muted">direct</span>}</div>
      </div>
      <div className="col-span-2 text-[11px] text-ink/80 min-w-0">
        <div className="uppercase tracking-wide text-[9px] text-muted">Project</div>
        <div className="truncate">{assignment.project || <span className="italic text-muted">—</span>}</div>
      </div>
      <div className="col-span-1 text-right">
        <div className="uppercase tracking-wide text-[9px] text-muted">Bill</div>
        <div className="text-[12px] tabular-nums text-ink font-semibold">
          <Sensitive>{`$${assignment.bill_rate}`}</Sensitive>
        </div>
      </div>
      <div className="col-span-1 text-right">
        <div className="uppercase tracking-wide text-[9px] text-muted">Margin</div>
        <div className="text-[12px] tabular-nums text-ink font-semibold">
          <Sensitive>{`${marginPct}%`}</Sensitive>
        </div>
      </div>
      <div className="col-span-1 text-right">
        <div className="uppercase tracking-wide text-[9px] text-muted">Monthly</div>
        <div className="text-[12px] tabular-nums text-ink font-semibold">
          <Sensitive>{`$${(rev / 1000).toFixed(1)}k`}</Sensitive>
        </div>
      </div>
    </div>
  );
}
