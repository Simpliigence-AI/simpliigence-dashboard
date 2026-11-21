/**
 * Concierge → Weekly. One row per active account: this week's check-in,
 * open issues, issues suggested from ticket mail / email / Slack, and the
 * client portal logins. Opening an account shows the check-in form, its issue
 * log, the suggestions and portal access.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Loader2, ChevronRight, X, Plus, CheckCircle2, Circle, Sparkles, Eye } from 'lucide-react';
import { Card, Button } from '../../components/ui';
import { alertError, toast } from '../../lib/planToast';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import {
  loadConciergeWeekly, saveConciergeCheckin, addConciergeIssue, setConciergeIssueState, setConciergeCheckinOwner,
  setConciergeDocVisible, fridayOf, checkinState, CHECKIN_STYLE, firstName,
  type ConciergeCheckin, type ConciergeIssue,
} from '../../lib/deliveryRebuild';
import { SuggestedIssues } from '../project-plans/SuggestedIssues';
import { PortalAccessCard } from '../project-plans/PortalTab';
import type { ExtractedIssue, IssueCriticality } from '../../types/delivery';

interface Acct { id: string; name: string; checkinOwner: string | null; portalSettings: Record<string, boolean> }

export function ConciergeWeeklyTab() {
  const [accounts, setAccounts] = useState<Acct[] | null>(null);
  const [data, setData] = useState<{ checkins: ConciergeCheckin[]; issues: ConciergeIssue[]; suggestions: ExtractedIssue[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ data: a, error }, w] = await Promise.all([
        supabase.from('concierge_accounts').select('id,name,checkin_owner,portal_settings,is_dormant').or('is_dormant.is.null,is_dormant.eq.false').order('name'),
        loadConciergeWeekly(),
      ]);
      if (error) throw new Error(error.message);
      setAccounts((a ?? []).map((r) => ({ id: r.id, name: r.name, checkinOwner: r.checkin_owner ?? null, portalSettings: r.portal_settings ?? {} })));
      setData(w);
    } catch (e) { alertError(e); setAccounts([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const lastByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data?.checkins ?? []) if (c.status === 'submitted' && (!m.get(c.accountId) || c.weekEnding > m.get(c.accountId)!)) m.set(c.accountId, c.weekEnding);
    return m;
  }, [data]);

  if (!accounts || !data) return <Card><div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading weekly check-ins…</div></Card>;

  const states = accounts.map((a) => checkinState(lastByAccount.get(a.id) ?? null, true));
  const done = states.filter((s) => s === 'done').length;
  const openIssues = data.issues.filter((i) => i.state === 'open').length;
  const acct = accounts.find((a) => a.id === open) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ['Active accounts', String(accounts.length)],
          ['Checked in this week', `${done}/${accounts.length}`],
          ['Open issues', String(openIssues)],
          ['Suggested issues', String(data.suggestions.length)],
        ] as const).map(([l, v]) => (
          <div key={l} className="rounded-xl border border-line/70 bg-surface px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{l}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{v}</div>
          </div>
        ))}
      </div>

      <Card flush>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="px-5 py-3 font-semibold">Account</th>
              <th className="px-3 py-3 font-semibold">Check-in by</th>
              <th className="px-3 py-3 font-semibold">This week (ending {new Date(fridayOf() + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })})</th>
              <th className="px-3 py-3 font-semibold text-right">Open issues</th>
              <th className="px-3 py-3 font-semibold text-right">Suggested</th>
              <th className="w-8 pr-4" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a, i) => {
              const st = states[i];
              const nIss = data.issues.filter((x) => x.accountId === a.id && x.state === 'open').length;
              const nSug = data.suggestions.filter((x) => x.conciergeAccountId === a.id).length;
              return (
                <tr key={a.id} onClick={() => setOpen(a.id)} className="border-b border-line/40 hover:bg-surface-2/50 cursor-pointer">
                  <td className="px-5 py-3 font-semibold text-ink">{a.name}</td>
                  <td className="px-3 py-3 text-muted">{firstName(a.checkinOwner)}</td>
                  <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-md text-xs font-bold ring-1 ring-inset ${CHECKIN_STYLE[st].cls}`}>{CHECKIN_STYLE[st].label}</span></td>
                  <td className="px-3 py-3 text-right tabular-nums">{nIss || <span className="text-muted/60">0</span>}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{nSug ? <span className="inline-flex items-center gap-1 font-semibold text-violet-600"><Sparkles size={12} />{nSug}</span> : <span className="text-muted/60">0</span>}</td>
                  <td className="pr-4 text-muted/60"><ChevronRight size={16} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {acct && (
        <AccountWeekly
          acct={acct}
          checkins={data.checkins.filter((c) => c.accountId === acct.id)}
          issues={data.issues.filter((x) => x.accountId === acct.id)}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function AccountWeekly({ acct, checkins, issues, onClose, onChanged }: { acct: Acct; checkins: ConciergeCheckin[]; issues: ConciergeIssue[]; onClose: () => void; onChanged: () => void }) {
  const week = fridayOf();
  const current = checkins.find((c) => c.weekEnding === week);
  const [form, setForm] = useState({ health: current?.health ?? null, summary: current?.summary ?? '', risks: current?.risks ?? '', nextWeek: current?.nextWeek ?? '' });
  const [busy, setBusy] = useState(false);
  const [desc, setDesc] = useState('');
  const [crit, setCrit] = useState<IssueCriticality>('medium');
  const directory = useAuthStore((s) => s.directory);
  const people = Object.values(directory).sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? ''));

  const save = async (submit: boolean) => {
    setBusy(true);
    try { await saveConciergeCheckin(acct.id, form, submit); toast(submit ? 'Check-in submitted' : 'Draft saved', 'ok'); onChanged(); } catch (e) { alertError(e); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-surface p-6 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Concierge · weekly</div>
            <h2 className="text-2xl font-bold text-ink">{acct.name}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={20} /></button>
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <ClipboardCheck size={16} className="text-muted" />
            <div className="font-bold text-ink">Check-in · week ending {new Date(week + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</div>
            {current?.status === 'submitted' && <span className="text-xs text-green font-semibold">Submitted by {firstName(current.submittedBy)}</span>}
            <label className="ml-auto text-xs text-muted flex items-center gap-1">Owner
              <select value={acct.checkinOwner ?? ''} onChange={(e) => setConciergeCheckinOwner(acct.id, e.target.value || null).then(onChanged).catch(alertError)} className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs">
                <option value="">— nobody —</option>
                {people.map((p) => <option key={p.email} value={p.email}>{p.fullName ?? p.email}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2 mb-3">
            {(['green', 'amber', 'red'] as const).map((h) => (
              <button key={h} onClick={() => setForm({ ...form, health: h })}
                className={`px-3 py-1 rounded-lg text-xs font-bold capitalize ring-1 ring-inset ${form.health === h ? (h === 'green' ? 'bg-emerald-500 text-white ring-emerald-500' : h === 'amber' ? 'bg-amber-500 text-white ring-amber-500' : 'bg-rose-500 text-white ring-rose-500') : 'ring-line text-muted'}`}>
                {h === 'green' ? 'On track' : h === 'amber' ? 'At risk' : 'Off track'}
              </button>
            ))}
          </div>
          {([['summary', 'What happened this week'], ['risks', 'Risks and blockers'], ['nextWeek', 'Next week']] as const).map(([k, label]) => (
            <label key={k} className="block text-xs font-semibold text-muted mb-2">{label}
              <textarea value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} rows={2} className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink font-normal" />
            </label>
          ))}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" disabled={busy} onClick={() => save(false)}>Save draft</Button>
            <Button disabled={busy || !form.health} onClick={() => save(true)}>Submit check-in</Button>
          </div>
          {checkins.filter((c) => c.status === 'submitted' && c.weekEnding !== week).slice(0, 4).map((c) => (
            <div key={c.id} className="mt-3 border-t border-line/50 pt-2 text-xs text-muted">
              <span className="font-semibold text-ink">{new Date(c.weekEnding + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> · {c.health ?? '—'} · {c.summary ?? ''}
            </div>
          ))}
        </Card>

        <SuggestedIssues conciergeAccountId={acct.id} canEdit onDecided={onChanged} />

        <Card flush>
          <div className="px-5 py-3 border-b border-line/60 font-bold text-ink">Issues <span className="text-muted font-normal">{issues.filter((i) => i.state === 'open').length} open</span></div>
          <ul className="divide-y divide-line/50">
            {issues.map((i) => (
              <li key={i.id} className={`flex items-start gap-3 px-5 py-2 text-sm ${i.state === 'closed' ? 'opacity-50' : ''}`}>
                <button onClick={() => setConciergeIssueState(i.id, i.state === 'open' ? 'closed' : 'open').then(onChanged).catch(alertError)} className="mt-0.5 text-muted hover:text-green">
                  {i.state === 'closed' ? <CheckCircle2 size={16} className="text-green" /> : <Circle size={16} />}
                </button>
                <span className="flex-1 text-ink">{i.description}</span>
                <span className="text-[11px] uppercase font-semibold text-muted">{i.criticality}</span>
              </li>
            ))}
            {!issues.length && <li className="px-5 py-3 text-sm text-muted">No issues logged.</li>}
          </ul>
          <form className="flex gap-2 px-5 py-3 border-t border-line/60" onSubmit={async (e) => {
            e.preventDefault();
            if (!desc.trim()) return;
            try { await addConciergeIssue(acct.id, desc, crit, null); setDesc(''); onChanged(); } catch (err) { alertError(err); }
          }}>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="New issue" className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
            <select value={crit} onChange={(e) => setCrit(e.target.value as IssueCriticality)} className="rounded-lg border border-line bg-surface px-2 text-sm">
              {(['low', 'medium', 'high', 'critical'] as const).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button type="submit" disabled={!desc.trim()}><Plus size={14} /> Add</Button>
          </form>
        </Card>

        <PortalAccessCard target={{ conciergeAccountId: acct.id }} canEdit company={acct.name} />
        <ConciergeDocSharing accountId={acct.id} />
      </div>
    </div>
  );
}

function ConciergeDocSharing({ accountId }: { accountId: string }) {
  const [docs, setDocs] = useState<{ id: string; title: string; visible: boolean; fromClient: string | null }[] | null>(null);
  useEffect(() => {
    supabase.from('concierge_account_documents').select('id,title,filename,client_visible,uploaded_by_client,storage_path').eq('account_id', accountId).order('uploaded_at', { ascending: false })
      .then(({ data }) => setDocs((data ?? []).filter((d) => d.storage_path).map((d) => ({ id: d.id, title: d.title || d.filename, visible: d.client_visible, fromClient: d.uploaded_by_client ?? null }))));
  }, [accountId]);
  if (!docs || !docs.length) return null;
  return (
    <Card flush>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-line/60 font-bold text-ink"><Eye size={15} className="text-muted" /> Documents on the portal</div>
      <ul className="divide-y divide-line/50">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-5 py-2 text-sm">
            <input type="checkbox" checked={d.visible || !!d.fromClient} disabled={!!d.fromClient} className="accent-primary"
              onChange={() => { const v = !d.visible; setDocs((all) => (all ?? []).map((x) => (x.id === d.id ? { ...x, visible: v } : x))); setConciergeDocVisible(d.id, v).catch(alertError); }} />
            <span className="flex-1 text-ink">{d.title}</span>
            {d.fromClient && <span className="text-[11px] text-violet-600">from {d.fromClient}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
