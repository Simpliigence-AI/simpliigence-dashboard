import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { USRosterMember, USRosterAssignment } from '../../types/usRoster';
import {
  US_ROSTER_STATUS_COLORS,
  calcAssignmentMonthlyRevenue,
} from '../../types/usRoster';
import { Card } from '../../components/ui';
import { Sensitive } from '../../components/Sensitive';
import { OwnerOnly } from '../../components/OwnerOnly';
import { useUSRosterStore } from '../../store/useUSRosterStore';
import { AssignmentEditorRow, AddAssignmentRow } from './AssignmentEditor';

/**
 * One row per consultant. Row shows identity + status + rolled-up totals
 * across all their contracts. Click to expand and manage the contracts inline.
 *
 * "Rolled-up" here means:
 *  - contracts count
 *  - blended monthly revenue = sum of (bill_rate * 160) across contracts
 *  - blended cost = sum of (cost_per_hour * 160)
 *  - blended margin = (revenue - cost) / revenue
 */
export function USRosterConsultantView({ members }: { members: USRosterMember[] }) {
  const allAssignments = useUSRosterStore((s) => s.assignments);
  const addAssignment = useUSRosterStore((s) => s.addAssignment);
  const updateAssignment = useUSRosterStore((s) => s.updateAssignment);
  const removeAssignment = useUSRosterStore((s) => s.removeAssignment);

  const byRosterId = useMemo(() => {
    const m = new Map<string, USRosterAssignment[]>();
    for (const a of allAssignments) {
      if (!m.has(a.roster_id)) m.set(a.roster_id, []);
      m.get(a.roster_id)!.push(a);
    }
    return m;
  }, [allAssignments]);

  // Autocomplete pools derived from the full assignment table so choices
  // stay consistent across consultants.
  const [siPool, endClientPool, projectPool] = useMemo(() => {
    const si = new Set<string>();
    const ec = new Set<string>();
    const pj = new Set<string>();
    for (const a of allAssignments) {
      if (a.si) si.add(a.si);
      if (a.end_client) ec.add(a.end_client);
      if (a.project) pj.add(a.project);
    }
    return [
      Array.from(si).sort(),
      Array.from(ec).sort(),
      Array.from(pj).sort(),
    ];
  }, [allAssignments]);

  if (members.length === 0) {
    return (
      <div className="text-center text-muted py-10 text-sm italic">
        No consultants match the current filters.
      </div>
    );
  }

  return (
    <Card className="p-0">
      <div className="divide-y divide-line/60">
        {members.map((m) => (
          <ConsultantRow
            key={m.id}
            member={m}
            assignments={byRosterId.get(m.id) ?? []}
            siPool={siPool}
            endClientPool={endClientPool}
            projectPool={projectPool}
            onAdd={addAssignment}
            onUpdate={updateAssignment}
            onRemove={removeAssignment}
          />
        ))}
      </div>
    </Card>
  );
}

function ConsultantRow({
  member, assignments, siPool, endClientPool, projectPool,
  onAdd, onUpdate, onRemove,
}: {
  member: USRosterMember;
  assignments: USRosterAssignment[];
  siPool: string[];
  endClientPool: string[];
  projectPool: string[];
  onAdd: (a: Omit<USRosterAssignment, 'id' | 'created_at' | 'updated_at'>) => void;
  onUpdate: (id: string, patch: Partial<USRosterAssignment>) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const totals = useMemo(() => {
    const rev = assignments.reduce((s, a) => s + calcAssignmentMonthlyRevenue(a), 0);
    const cost = assignments.reduce((s, a) => s + (a.cost_per_hour || 0) * 160, 0);
    const margin = rev > 0 ? Math.round(((rev - cost) / rev) * 100) : 0;
    return { rev, cost, margin };
  }, [assignments]);

  const statusColor = US_ROSTER_STATUS_COLORS[member.status] ?? '#94a3b8';

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full grid grid-cols-12 gap-3 items-center px-3 py-2.5 text-left hover:bg-surface-2/40 transition-colors"
      >
        <div className="col-span-3 flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown size={14} className="text-muted flex-shrink-0" /> : <ChevronRight size={14} className="text-muted flex-shrink-0" />}
          <div className="min-w-0">
            <div className="font-semibold text-ink text-sm truncate">{member.name}</div>
            <div className="text-[11px] text-muted truncate">
              {member.role || '—'} {member.location && `· ${member.location}`}
            </div>
          </div>
        </div>
        <div className="col-span-2">
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: `${statusColor}22`, color: statusColor }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
            {member.status}
          </span>
          <div className="text-[10px] text-muted mt-0.5">{member.visa_category}</div>
        </div>
        <div className="col-span-2 text-[11px] text-ink/80 tabular-nums">
          {assignments.length === 0 ? (
            <span className="italic text-muted">no contracts</span>
          ) : (
            <>
              <div className="font-semibold">{assignments.length} contract{assignments.length === 1 ? '' : 's'}</div>
              <div className="text-[10px] text-muted truncate max-w-[200px]">
                {assignments.map((a) => a.end_client || a.project || a.si || '?').join(' · ')}
              </div>
            </>
          )}
        </div>
        <div className="col-span-2 text-right">
          <div className="text-[11px] text-muted uppercase tracking-wide">Monthly</div>
          <div className="text-sm font-bold text-ink tabular-nums">
            <OwnerOnly><Sensitive>{`$${(totals.rev / 1000).toFixed(1)}k`}</Sensitive></OwnerOnly>
          </div>
        </div>
        <div className="col-span-2 text-right">
          <div className="text-[11px] text-muted uppercase tracking-wide">Margin</div>
          <div className="text-sm font-bold text-ink tabular-nums">
            <OwnerOnly><Sensitive>{`${totals.margin}%`}</Sensitive></OwnerOnly>
          </div>
        </div>
        <div className="col-span-1 text-right text-[11px] text-muted">
          {expanded ? 'hide' : 'edit'}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 bg-surface-2/20 space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted px-2 pt-2 grid grid-cols-12 gap-2">
            <div className="col-span-3">SI</div>
            <div className="col-span-3">End client</div>
            <div className="col-span-2">Project</div>
            <div className="col-span-1 text-right">Cost/hr</div>
            <div className="col-span-1 text-right">Bill/hr</div>
            <div className="col-span-1 text-right">Margin</div>
            <div className="col-span-1"></div>
          </div>
          {assignments.map((a) => (
            <AssignmentEditorRow
              key={a.id}
              assignment={a}
              onChange={(patch) => onUpdate(a.id, patch)}
              onDelete={() => onRemove(a.id)}
              siSuggestions={siPool}
              endClientSuggestions={endClientPool}
              projectSuggestions={projectPool}
            />
          ))}
          <AddAssignmentRow
            rosterId={member.id}
            onCreate={onAdd}
            siSuggestions={siPool}
            endClientSuggestions={endClientPool}
            projectSuggestions={projectPool}
          />
        </div>
      )}
    </div>
  );
}
