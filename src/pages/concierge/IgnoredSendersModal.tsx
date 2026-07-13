/**
 * IgnoredSendersModal
 *
 * Small settings surface on the Concierge page for managing the email
 * blocklist that stops noisy senders from becoming tickets. Backed by
 * concierge_ignored_senders. The desk-inbound edge fn checks this table
 * on every incoming message and drops matches before ticket creation.
 *
 * Three match kinds:
 *   - email:     exact match (whole address)
 *   - domain:    everything after "@" (e.g. "launch27.com")
 *   - substring: match anywhere in the sender email (catches all
 *                subdomains + variants of a noisy vendor)
 *
 * Rows show how many messages each rule has suppressed and when it last
 * fired, so you can see whether a rule is doing anything.
 */
import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2, AlertTriangle, ShieldOff, Check } from 'lucide-react';
import { Button } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';

type IgnoredKind = 'email' | 'domain' | 'substring';
interface IgnoredRule {
  id: string;
  pattern: string;
  kind: IgnoredKind;
  reason: string | null;
  isActive: boolean;
  addedBy: string | null;
  addedAt: string;
  suppressedCount: number;
  lastSuppressedAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(r: any): IgnoredRule {
  return {
    id: r.id,
    pattern: r.pattern,
    kind: r.kind,
    reason: r.reason ?? null,
    isActive: r.is_active ?? true,
    addedBy: r.added_by ?? null,
    addedAt: r.added_at,
    suppressedCount: Number(r.suppressed_count ?? 0),
    lastSuppressedAt: r.last_suppressed_at ?? null,
  };
}

export function IgnoredSendersModal({ onClose }: { onClose: () => void }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [rules, setRules] = useState<IgnoredRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addPattern, setAddPattern] = useState('');
  const [addKind, setAddKind] = useState<IgnoredKind>('substring');
  const [addReason, setAddReason] = useState('');

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('concierge_ignored_senders').select('*').order('added_at', { ascending: false });
    if (error) setErr(error.message); else setRules((data ?? []).map(rowTo));
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function add() {
    if (!addPattern.trim()) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from('concierge_ignored_senders').insert({
        pattern: addPattern.trim().toLowerCase(),
        kind: addKind,
        reason: addReason.trim() || null,
        added_by: currentUser?.email ?? null,
      });
      if (error) throw new Error(error.message);
      setAddPattern(''); setAddReason('');
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function toggle(rule: IgnoredRule) {
    await supabase.from('concierge_ignored_senders').update({ is_active: !rule.isActive }).eq('id', rule.id);
    await load();
  }

  async function remove(rule: IgnoredRule) {
    if (!confirm(`Remove ignore rule for "${rule.pattern}"?`)) return;
    await supabase.from('concierge_ignored_senders').delete().eq('id', rule.id);
    await load();
  }

  const totalSuppressed = rules.reduce((s, r) => s + r.suppressedCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <ShieldOff size={14} className="text-rose-600" /> Ignored senders
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Emails matching any active rule are dropped before ticket creation.
              {totalSuppressed > 0 && <> · <span className="font-semibold text-slate-700">{totalSuppressed}</span> total suppressed to date.</>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Add form */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Add rule</div>
            <div className="grid grid-cols-4 gap-2">
              <select value={addKind} onChange={(e) => setAddKind(e.target.value as IgnoredKind)} className="px-2 py-1.5 rounded border border-slate-300 text-xs bg-white">
                <option value="substring">Contains</option>
                <option value="domain">Domain</option>
                <option value="email">Exact email</option>
              </select>
              <input
                type="text"
                value={addPattern}
                onChange={(e) => setAddPattern(e.target.value)}
                placeholder={addKind === 'email' ? 'noreply@vendor.com' : addKind === 'domain' ? 'vendor.com' : 'launch27'}
                className="col-span-2 px-2 py-1.5 rounded border border-slate-300 text-xs"
              />
              <Button variant="primary" size="sm" onClick={add} disabled={!addPattern.trim() || busy}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                <span className="ml-1">Add</span>
              </Button>
            </div>
            <input
              type="text"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              placeholder="Why (optional) — e.g. Noise, automated notifications, not real tickets"
              className="w-full px-2 py-1.5 rounded border border-slate-300 text-xs"
            />
          </div>

          {err && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </div>
          )}

          {/* Rules list */}
          {loading ? (
            <div className="text-center text-slate-500 py-6 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
          ) : rules.length === 0 ? (
            <div className="text-center text-slate-400 italic text-sm py-6">No ignore rules yet.</div>
          ) : (
            <ul className="space-y-1.5">
              {rules.map((r) => (
                <li key={r.id} className={`rounded-lg border p-2.5 ${r.isActive ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => toggle(r)}
                      title={r.isActive ? 'Disable rule' : 'Enable rule'}
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        r.isActive ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {r.isActive ? <ShieldOff size={9} /> : <Check size={9} />}
                      {r.isActive ? 'Active' : 'Disabled'}
                    </button>
                    <span className="text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded">
                      {r.kind === 'email' ? 'exact' : r.kind === 'domain' ? 'domain' : 'contains'}
                    </span>
                    <code className="text-sm font-mono font-semibold text-slate-900 flex-1 min-w-0 truncate">{r.pattern}</code>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap">
                      {r.suppressedCount > 0
                        ? `${r.suppressedCount} suppressed${r.lastSuppressedAt ? ` · last ${new Date(r.lastSuppressedAt).toLocaleDateString()}` : ''}`
                        : 'not yet triggered'}
                    </span>
                    <button type="button" onClick={() => remove(r)} className="text-slate-400 hover:text-rose-600 p-1" title="Remove"><Trash2 size={13} /></button>
                  </div>
                  {r.reason && <div className="text-[11px] text-slate-600 mt-1 pl-1">{r.reason}</div>}
                  <div className="text-[10px] text-slate-400 mt-0.5 pl-1">
                    Added {new Date(r.addedAt).toLocaleDateString()}{r.addedBy ? ` by ${r.addedBy}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
