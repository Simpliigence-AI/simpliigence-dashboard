/**
 * QuickIdeaModal — capture an innovation idea in ~5 seconds, from anywhere
 * on the Accounts page.
 *
 * Before this existed, logging an idea meant: find the account → expand the
 * row → click "More:" → click Innovation → click Add → fill a blank inline
 * row. Five clicks before you could type. Ideas surfaced in a hallway
 * conversation never made it in.
 *
 * Now: one button (or `i` anywhere on the page), pick the account, type a
 * title, hit save. Description / impact / date are optional — the point is
 * to capture the thought before it evaporates; it can be fleshed out later
 * on the account's Innovation tab.
 *
 * Writes straight to `account_innovations`, the same table InnovationTab
 * reads, so a saved idea shows up there immediately (that tab has a
 * realtime subscription keyed on account_id).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb, Loader2, X, Check, Search } from 'lucide-react';
import { nanoid } from 'nanoid';
import { supabase, CLIENT_ID } from '../../lib/supabase';

interface AccountLite { id: string; name: string; }

interface Props {
  accounts: AccountLite[];
  /** Pre-select this account (usually whichever is open in the right pane). */
  defaultAccountId?: string | null;
  onClose: () => void;
  /** Fired after a successful save so the parent can toast / refresh. */
  onSaved?: (accountId: string, title: string) => void;
}

export function QuickIdeaModal({ accounts, defaultAccountId, onClose, onSaved }: Props) {
  const [accountId, setAccountId] = useState<string>(defaultAccountId || accounts[0]?.id || '');
  const [acctQuery, setAcctQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState('');
  const [datedAt, setDatedAt] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Focus the title immediately — the whole point is speed.
  useEffect(() => { titleRef.current?.focus(); }, []);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filteredAccounts = useMemo(() => {
    const q = acctQuery.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => a.name.toLowerCase().includes(q));
  }, [accounts, acctQuery]);

  const selectedName = accounts.find((a) => a.id === accountId)?.name ?? '';

  const save = async (keepOpen: boolean) => {
    if (!accountId) { setError('Pick an account.'); return; }
    if (!title.trim()) { setError('Give the idea a title.'); return; }
    setSaving(true);
    setError(null);
    const now = new Date().toISOString();
    const { error: e } = await supabase.from('account_innovations').insert({
      id: nanoid(),
      account_id: accountId,
      title: title.trim(),
      description: description.trim(),
      impact: impact.trim(),
      dated_at: datedAt || null,
      updated_by: CLIENT_ID,
      updated_at: now,
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    onSaved?.(accountId, title.trim());
    if (keepOpen) {
      // "Save & add another" — keep the account + date, clear the content so
      // a brainstorm session can dump several ideas in a row.
      setTitle('');
      setDescription('');
      setImpact('');
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1600);
      titleRef.current?.focus();
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white">
          <span className="w-7 h-7 rounded-lg bg-amber-400 text-white flex items-center justify-center flex-shrink-0">
            <Lightbulb size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900">Capture an idea</div>
            <div className="text-[11px] text-slate-500">
              Goes to the account&apos;s Innovation tab. Title is all you need.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Account picker — searchable when the list is long */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Account</label>
            {accounts.length > 8 && (
              <div className="relative mt-1 mb-1.5">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={acctQuery}
                  onChange={(e) => setAcctQuery(e.target.value)}
                  placeholder="Filter accounts…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            )}
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {filteredAccounts.length === 0 && <option value="">No account matches “{acctQuery}”</option>}
              {filteredAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Title — the only required field */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Idea <span className="text-rose-500">*</span>
            </label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter = save & close; plain Enter = save & add another
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(false); }
                else if (e.key === 'Enter') { e.preventDefault(); void save(true); }
              }}
              placeholder="e.g. Auto-generate their monthly QBR deck from Salesforce data"
              className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          {/* Optional detail — collapsed visually but always available */}
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Detail <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's the thought? Any context worth keeping."
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Impact <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span>
                </label>
                <input
                  value={impact}
                  onChange={(e) => setImpact(e.target.value)}
                  placeholder="e.g. saves ~6 hrs/month"
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Date</label>
                <input
                  type="date"
                  value={datedAt}
                  onChange={(e) => setDatedAt(e.target.value)}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-2">
              {error}
            </div>
          )}
          {savedFlash && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-2 inline-flex items-center gap-1.5">
              <Check size={12} /> Saved to {selectedName}. Add another —
            </div>
          )}
        </div>

        {/* Footer — hint on its own row so the three buttons never get
         *  squeezed at this modal width. */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
          <div className="text-[10px] text-slate-400 mb-2">
            <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[9px]">Enter</kbd> save &amp; add another ·{' '}
            <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[9px]">⌘↵</kbd> save &amp; close ·{' '}
            <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[9px]">Esc</kbd> close
          </div>
          <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={saving}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-amber-300 bg-white text-amber-800 hover:bg-amber-50 disabled:opacity-50"
          >
            Save &amp; add another
          </button>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Lightbulb size={12} />}
            {saving ? 'Saving…' : 'Save idea'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
