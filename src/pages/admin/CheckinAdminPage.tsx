/**
 * Check-in admin — the matrix.
 *
 * Three things live here, all owner-only (the database enforces it; this
 * page only hides the controls):
 *   1. People — who gets a scorecard, in which function, on which data scope.
 *   2. KPIs — the catalogue per function. Adding one is a row, not a release.
 *   3. The matrix — which KPIs sit on whose card.
 *
 * A new person inherits their function's template, so the common case needs
 * no matrix work at all.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, AlertCircle, X, Check, Minus } from 'lucide-react';
import { useCheckinStore } from '../../store/useCheckinStore';

export default function CheckinAdminPage() {
  const {
    functions, scopes, members, kpis, matrix, isOwner, error, clearError,
    loadConfig, addMember, addKpi, toggleMatrix, setMemberActive, setMemberScope,
  } = useCheckinStore();

  const [functionKey, setFunctionKey] = useState('sales');
  const [showAddPerson, setShowAddPerson] = useState(false);
  const [showAddKpi, setShowAddKpi] = useState(false);

  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const roster = useMemo(
    () => members.filter((m) => m.functionKey === functionKey),
    [members, functionKey],
  );
  const functionKpis = useMemo(
    () => kpis.filter((k) => k.active && (k.functionKey === functionKey || k.functionKey === null)),
    [kpis, functionKey],
  );

  const on = (email: string, kpiKey: string) =>
    matrix.some((m) => m.ownerEmail === email && m.kpiKey === kpiKey && m.active);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Check-in admin</h1>
          <p className="text-[13px] text-muted mt-0.5 max-w-[64ch]">
            Who gets a scorecard, what each function measures, and which KPIs sit on whose card.
            A new person inherits their function&rsquo;s template — you only come here to diverge from it.
          </p>
        </div>
        {!isOwner && (
          <span className="text-[11px] px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700">
            Read-only — you are not a check-in owner
          </span>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={clearError} className="p-0.5 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {functions.map((f) => (
          <button
            key={f.functionKey}
            onClick={() => setFunctionKey(f.functionKey)}
            className={`px-3.5 py-2 text-[13.5px] whitespace-nowrap border-b-2 transition ${
              f.functionKey === functionKey
                ? 'border-primary text-ink font-semibold'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {f.label.replace(/ Check-in$/, '')}
          </button>
        ))}
      </div>

      {/* People */}
      <section className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
          <h2 className="text-sm font-bold text-ink">People</h2>
          {isOwner && (
            <button
              onClick={() => setShowAddPerson((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-white text-[12px] font-medium"
            >
              <Plus size={13} /> Add someone
            </button>
          )}
        </div>

        {showAddPerson && isOwner && (
          <AddPersonForm
            functionKey={functionKey}
            scopes={scopes.map((s) => ({ key: s.scopeKey, label: s.label }))}
            onCancel={() => setShowAddPerson(false)}
            onSave={async (email, name, scopeKey) => {
              const err = await addMember(email, name, functionKey, scopeKey);
              if (!err) setShowAddPerson(false);
            }}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.09em] text-muted">
                <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">Name</th>
                <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">Email</th>
                <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">Data scope</th>
                <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">Note</th>
                <th className="text-right font-normal px-4 py-2.5 border-b border-line/60">Active</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((m) => (
                <tr key={m.email} className="hover:bg-surface-2 transition">
                  <td className="px-4 py-2.5 border-b border-line/40 text-[13.5px] font-medium text-ink">{m.displayName}</td>
                  <td className="px-4 py-2.5 border-b border-line/40 text-[12.5px] text-muted">{m.email}</td>
                  <td className="px-4 py-2.5 border-b border-line/40">
                    <select
                      value={m.scopeKey}
                      disabled={!isOwner}
                      onChange={(e) => void setMemberScope(m.email, e.target.value)}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] focus:outline-none focus:border-primary disabled:opacity-60"
                    >
                      {scopes.map((s) => <option key={s.scopeKey} value={s.scopeKey}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-2.5 border-b border-line/40 text-[11.5px] text-muted italic max-w-[280px]">
                    {m.notes ?? ''}
                  </td>
                  <td className="px-4 py-2.5 border-b border-line/40 text-right">
                    <button
                      disabled={!isOwner}
                      onClick={() => void setMemberActive(m.email, !m.active)}
                      className={`px-2 py-1 rounded-md text-[11px] font-medium ${
                        m.active ? 'bg-emerald-50 text-emerald-700' : 'bg-surface-2 text-muted'
                      } disabled:opacity-60`}
                    >
                      {m.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                </tr>
              ))}
              {!roster.length && (
                <tr><td colSpan={5} className="px-4 py-5 text-center text-[13px] text-muted">
                  Nobody on this check-in yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* KPIs + matrix */}
      <section className="rounded-xl border border-line bg-surface overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line/60">
          <div>
            <h2 className="text-sm font-bold text-ink">KPIs and the matrix</h2>
            <p className="text-[11.5px] text-muted mt-0.5 m-0">
              Rows are this function&rsquo;s KPIs; columns are its people. Click a cell to put a
              KPI on someone&rsquo;s card or take it off.
            </p>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowAddKpi((v) => !v)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary text-white text-[12px] font-medium"
            >
              <Plus size={13} /> Add a KPI
            </button>
          )}
        </div>

        {showAddKpi && isOwner && (
          <AddKpiForm
            functionKey={functionKey}
            onCancel={() => setShowAddKpi(false)}
            onSave={async (p) => {
              const err = await addKpi({ ...p, functionKey });
              if (!err) setShowAddKpi(false);
            }}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.09em] text-muted">
                <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">KPI</th>
                <th className="text-left font-normal px-4 py-2.5 border-b border-line/60">Source</th>
                {roster.map((m) => (
                  <th key={m.email} className="text-center font-normal px-3 py-2.5 border-b border-line/60 whitespace-nowrap">
                    {m.displayName.split(' ')[0]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {functionKpis.map((k) => (
                <tr key={k.kpiKey} className="hover:bg-surface-2 transition">
                  <td className="px-4 py-2.5 border-b border-line/40">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[13.5px] font-medium text-ink">{k.label}</span>
                      {k.description && (
                        <span className="text-[11px] text-muted line-clamp-2 max-w-[420px]">{k.description}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 border-b border-line/40">
                    <span className={`text-[9.5px] uppercase tracking-[0.07em] px-1.5 py-0.5 rounded ${
                      k.actualSource === 'auto'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-surface-2 text-muted border border-line'
                    }`}>
                      {k.actualSource}
                    </span>
                  </td>
                  {roster.map((m) => {
                    const isOn = on(m.email, k.kpiKey);
                    return (
                      <td key={m.email} className="px-3 py-2.5 border-b border-line/40 text-center">
                        <button
                          disabled={!isOwner}
                          onClick={() => void toggleMatrix(m.email, k.kpiKey, !isOn)}
                          title={isOn ? `Remove from ${m.displayName}'s card` : `Add to ${m.displayName}'s card`}
                          className={`w-6 h-6 rounded-md inline-flex items-center justify-center transition ${
                            isOn ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                 : 'bg-surface-2 text-muted/50 hover:text-muted'
                          } disabled:opacity-60 disabled:hover:bg-surface-2`}
                        >
                          {isOn ? <Check size={13} /> : <Minus size={13} />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!functionKpis.length && (
                <tr><td colSpan={2 + roster.length} className="px-4 py-5 text-center text-[13px] text-muted">
                  No KPIs defined for this function yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AddPersonForm({ functionKey, scopes, onSave, onCancel }: {
  functionKey: string;
  scopes: { key: string; label: string }[];
  onSave: (email: string, name: string, scopeKey: string) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [scopeKey, setScopeKey] = useState('none');
  const ready = email.includes('@') && name.trim().length > 0;

  return (
    <div className="px-4 py-3 border-b border-line/60 bg-surface-2/60 flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">Email</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@simpliigence.com"
          className="w-56 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya"
          className="w-44 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">Data scope</span>
        <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary">
          {scopes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <button onClick={() => onSave(email.trim().toLowerCase(), name.trim(), scopeKey)} disabled={!ready}
        className="px-3.5 py-2 rounded-lg bg-primary text-white text-[12.5px] font-medium disabled:opacity-40">
        Add to {functionKey}
      </button>
      <button onClick={onCancel} className="px-2 py-2 text-[12.5px] text-muted hover:text-ink">Cancel</button>
    </div>
  );
}

function AddKpiForm({ functionKey, onSave, onCancel }: {
  functionKey: string;
  onSave: (p: { kpiKey: string; label: string; description?: string; unit?: string; direction?: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('count');
  const [direction, setDirection] = useState('higher');

  // Derive a stable key from the label so nobody has to invent one.
  const kpiKey = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const ready = kpiKey.length > 2;

  return (
    <div className="px-4 py-3 border-b border-line/60 bg-surface-2/60 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">KPI name</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Offers released"
            className="w-56 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">Unit</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary">
            <option value="count">Count</option>
            <option value="hours">Hours</option>
            <option value="percent">Percent</option>
            <option value="currency">Currency</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-muted">Better when</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value)}
            className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary">
            <option value="higher">Higher</option>
            <option value="lower">Lower</option>
          </select>
        </label>
        <button onClick={() => onSave({ kpiKey, label: label.trim(), description: description.trim() || undefined, unit, direction })}
          disabled={!ready}
          className="px-3.5 py-2 rounded-lg bg-primary text-white text-[12.5px] font-medium disabled:opacity-40">
          Add to {functionKey}
        </button>
        <button onClick={onCancel} className="px-2 py-2 text-[12.5px] text-muted hover:text-ink">Cancel</button>
      </div>
      <input value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="How this is counted, and by whom — the people filling it in will read this."
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-primary" />
      <p className="text-[11px] text-muted m-0">
        New KPIs are entered by hand. Wiring one to compute automatically needs a metric
        added to <code className="text-ink">v_checkin_metrics</code>.
        {ready && <> Key: <code className="text-ink">{kpiKey}</code></>}
      </p>
    </div>
  );
}
