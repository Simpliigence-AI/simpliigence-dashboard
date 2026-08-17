import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MONTHS } from '../../types/forecast';
import type { Month } from '../../types/forecast';
import type { RoleCategory, StaffingRequest } from '../../types/hiringForecast';
import { ROLE_CATEGORIES, ROLE_CATEGORY_LABELS } from '../../types/hiringForecast';

interface Props {
  requests: StaffingRequest[];
  onAdd: (req: Omit<StaffingRequest, 'id'>) => void;
  onRemove: (id: string) => void;
}

export function StaffingRequestList({ requests, onAdd, onRemove }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [role, setRole] = useState<RoleCategory>('JuniorDev');
  const [hours, setHours] = useState(160);
  const [startMonth, setStartMonth] = useState<Month>('Jan');
  const [endMonth, setEndMonth] = useState<Month>('Dec');
  const [client, setClient] = useState('');

  const handleSubmit = () => {
    onAdd({ roleCategory: role, hoursPerMonth: hours, startMonth, endMonth, clientName: client });
    setShowForm(false);
    setClient('');
    setHours(160);
  };

  return (
    <div>
      {requests.length === 0 && !showForm && (
        <p className="text-sm text-muted/70 mb-3">No staffing requests yet.</p>
      )}

      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between py-2 border-b border-line/40 group">
          <div>
            <span className="text-sm font-medium text-ink/80">
              {ROLE_CATEGORY_LABELS[r.roleCategory]}
            </span>
            <span className="text-xs text-muted ml-2">
              {r.hoursPerMonth} hrs/mo &middot; {r.startMonth}–{r.endMonth}
              {r.clientName && <> &middot; {r.clientName}</>}
            </span>
          </div>
          <button
            onClick={() => onRemove(r.id)}
            className="text-line hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      {showForm ? (
        <div className="mt-3 space-y-2 bg-surface-2/70 rounded-lg p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-muted uppercase">Role</label>
              <select
                className="w-full rounded border border-line px-2 py-1.5 text-xs"
                value={role}
                onChange={(e) => setRole(e.target.value as RoleCategory)}
              >
                {ROLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{ROLE_CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted uppercase">Hrs/Month</label>
              <input
                type="number"
                min={0}
                step={10}
                className="w-full rounded border border-line px-2 py-1.5 text-xs"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-muted uppercase">Start</label>
              <select
                className="w-full rounded border border-line px-2 py-1.5 text-xs"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value as Month)}
              >
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted uppercase">End</label>
              <select
                className="w-full rounded border border-line px-2 py-1.5 text-xs"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value as Month)}
              >
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted uppercase">Client (optional)</label>
            <input
              type="text"
              className="w-full rounded border border-line px-2 py-1.5 text-xs"
              placeholder="e.g., CoolAir expansion"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSubmit}
              className="flex-1 bg-primary text-white text-xs font-medium px-3 py-1.5 rounded hover:bg-primary/90"
            >
              Add Request
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-muted px-3 py-1.5 rounded hover:bg-line/60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="mt-3 flex items-center gap-1.5 text-xs text-primary font-medium hover:text-primary/80"
        >
          <Plus size={14} /> Add Staffing Request
        </button>
      )}
    </div>
  );
}
