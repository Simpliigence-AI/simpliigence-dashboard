import { useState } from 'react';
import { FolderPlus, Trash2, CloudDownload } from 'lucide-react';
import { MONTHS } from '../../types/forecast';
import type { Month } from '../../types/forecast';
import type { PipelineProject, RoleCategory } from '../../types/hiringForecast';
import { ROLE_CATEGORY_LABELS } from '../../types/hiringForecast';

const STATUS_COLORS: Record<string, string> = {
  'In Progress': 'bg-blue-100 text-blue-700',
  'On Track': 'bg-green-100 text-green-700',
  'Active': 'bg-green-100 text-green-700',
  'Delayed': 'bg-red-100 text-red-700',
  'Completed': 'bg-surface-2 text-muted',
};

interface Props {
  projects: PipelineProject[];
  onAdd: (proj: Omit<PipelineProject, 'id'>) => void;
  onRemove: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Omit<PipelineProject, 'id'>>) => void;
  onSyncZoho?: () => Promise<void>;
  isSyncingZoho?: boolean;
  lastZohoSync?: string | null;
}

export function PipelineProjectList({
  projects,
  onAdd,
  onRemove,
  onUpdate,
  onSyncZoho,
  isSyncingZoho,
  lastZohoSync,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [startMonth, setStartMonth] = useState<Month>('Apr');
  const [endMonth, setEndMonth] = useState<Month>('Dec');
  const [baCount, setBaCount] = useState(0);
  const [jdCount, setJdCount] = useState(0);
  const [sdCount, setSdCount] = useState(0);
  const [hrsPerPerson, setHrsPerPerson] = useState(160);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) return;
    onAdd({
      projectName: name.trim(),
      startMonth,
      endMonth,
      headcount: { BA: baCount, JuniorDev: jdCount, SeniorDev: sdCount },
      hoursPerPerson: hrsPerPerson,
      source: 'manual',
    });
    setShowForm(false);
    setName('');
    setBaCount(0);
    setJdCount(0);
    setSdCount(0);
  };

  const totalPeople = (p: PipelineProject) =>
    p.headcount.BA + p.headcount.JuniorDev + p.headcount.SeniorDev;

  return (
    <div>
      {/* Zoho sync button */}
      {onSyncZoho && (
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-line/60">
          <div className="flex items-center gap-2">
            <button
              onClick={onSyncZoho}
              disabled={isSyncingZoho}
              className="flex items-center gap-1.5 text-xs font-medium bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-100 disabled:opacity-50"
            >
              <CloudDownload size={14} className={isSyncingZoho ? 'animate-spin' : ''} />
              {isSyncingZoho ? 'Syncing...' : 'Sync from Zoho Projects'}
            </button>
            {lastZohoSync && (
              <span className="text-[10px] text-muted/70">
                Last synced: {new Date(lastZohoSync).toLocaleDateString()}
              </span>
            )}
          </div>
          <span className="text-[10px] text-muted/70">
            {projects.filter((p) => p.source === 'zoho').length} from Zoho, {projects.filter((p) => p.source !== 'zoho').length} manual
          </span>
        </div>
      )}

      {projects.length === 0 && !showForm && (
        <p className="text-sm text-muted/70 mb-3">No pipeline projects added yet.</p>
      )}

      {projects.map((p) => (
        <div key={p.id} className="py-3 border-b border-line/60 group">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink">{p.projectName}</span>
                <span className="text-[10px] text-muted/70 bg-surface-2/70 px-1.5 py-0.5 rounded">
                  {p.startMonth}–{p.endMonth}
                </span>
                {p.source === 'zoho' && (
                  <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                    Zoho
                  </span>
                )}
                {p.zohoStatus && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[p.zohoStatus] || 'bg-surface-2 text-muted'}`}>
                    {p.zohoStatus}
                  </span>
                )}
                {p.zohoOwner && (
                  <span className="text-[10px] text-muted/70">{p.zohoOwner}</span>
                )}
              </div>

              {/* Resource headcount — inline editable for Zoho projects */}
              {editingId === p.id ? (
                <div className="mt-2 flex items-center gap-2">
                  {(['BA', 'JuniorDev', 'SeniorDev'] as RoleCategory[]).map((cat) => (
                    <div key={cat} className="flex items-center gap-1">
                      <label className="text-[10px] text-muted/70">{ROLE_CATEGORY_LABELS[cat].split(' ')[0]}</label>
                      <input
                        type="number"
                        min={0}
                        className="w-12 rounded border border-line px-1 py-0.5 text-xs text-center"
                        value={p.headcount[cat]}
                        onChange={(e) => onUpdate?.(p.id, {
                          headcount: { ...p.headcount, [cat]: Math.max(0, Number(e.target.value) || 0) },
                        })}
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-[10px] text-primary font-medium ml-2"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="flex gap-3 mt-1.5">
                  {totalPeople(p) > 0 ? (
                    <>
                      {(['BA', 'JuniorDev', 'SeniorDev'] as RoleCategory[]).map(
                        (cat) =>
                          p.headcount[cat] > 0 && (
                            <span key={cat} className="text-xs text-muted">
                              <span className="font-medium text-ink/80">{p.headcount[cat]}</span>{' '}
                              {ROLE_CATEGORY_LABELS[cat]}
                            </span>
                          ),
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => setEditingId(p.id)}
                      className="text-[10px] text-primary/60 hover:text-primary font-medium"
                    >
                      + Set resource needs
                    </button>
                  )}
                  {totalPeople(p) > 0 && onUpdate && (
                    <button
                      onClick={() => setEditingId(p.id)}
                      className="text-[10px] text-line hover:text-primary ml-1"
                      title="Edit resources"
                    >
                      edit
                    </button>
                  )}
                </div>
              )}

              {totalPeople(p) > 0 && (
                <div className="text-[10px] text-muted/70 mt-1">
                  {totalPeople(p)} people x {p.hoursPerPerson} hrs/mo = {totalPeople(p) * p.hoursPerPerson} hrs/mo total
                </div>
              )}
            </div>
            <button
              onClick={() => onRemove(p.id)}
              className="text-line hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity mt-1"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}

      {showForm ? (
        <div className="mt-3 space-y-3 bg-surface-2/70 rounded-lg p-3">
          <div>
            <label className="text-[10px] font-medium text-muted uppercase">Project Name</label>
            <input
              type="text"
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              placeholder="e.g., Acme Corp Implementation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-muted uppercase">Start</label>
              <select
                className="w-full rounded border border-line px-2 py-1.5 text-xs"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value as Month)}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-muted uppercase">End</label>
              <select
                className="w-full rounded border border-line px-2 py-1.5 text-xs"
                value={endMonth}
                onChange={(e) => setEndMonth(e.target.value as Month)}
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium text-muted uppercase mb-1 block">
              Resources Needed (headcount)
            </label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted/70">BAs</label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border border-line px-2 py-1.5 text-xs text-center"
                  value={baCount}
                  onChange={(e) => setBaCount(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted/70">Jr Devs</label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border border-line px-2 py-1.5 text-xs text-center"
                  value={jdCount}
                  onChange={(e) => setJdCount(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted/70">Sr Devs</label>
                <input
                  type="number"
                  min={0}
                  className="w-full rounded border border-line px-2 py-1.5 text-xs text-center"
                  value={sdCount}
                  onChange={(e) => setSdCount(Math.max(0, Number(e.target.value) || 0))}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium text-muted uppercase">Hrs/Person/Month</label>
            <input
              type="number"
              min={0}
              step={10}
              className="w-24 rounded border border-line px-2 py-1.5 text-xs"
              value={hrsPerPerson}
              onChange={(e) => setHrsPerPerson(Number(e.target.value) || 160)}
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={!name.trim() || (baCount + jdCount + sdCount === 0)}
              className="flex-1 bg-primary text-white text-xs font-medium px-3 py-1.5 rounded hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add Project
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
          <FolderPlus size={14} /> Add Pipeline Project
        </button>
      )}
    </div>
  );
}
