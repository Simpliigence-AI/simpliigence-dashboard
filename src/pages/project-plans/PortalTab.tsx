/**
 * Client portal settings for one project (or, via PortalAccessCard, one
 * Concierge account): what the client sees, which documents are shared, and
 * the people who can sign in. Passwords are shown once, when issued.
 */
import { useCallback, useEffect, useState } from 'react';
import { Globe, KeyRound, Copy, UserPlus, Trash2, Loader2, Eye, EyeOff, Power, FileCheck2, Upload } from 'lucide-react';
import { Card, Button } from '../../components/ui';
import { alertError, toast } from '../../lib/planToast';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import {
  PORTAL_URL, loadPortalAccess, grantPortalAccess, revokePortalAccess, setPortalPassword, generatePassword,
  setPortalUserActive, loadProjectDocsForSharing, setDocumentSharing, portalActivity, type PortalUser, type SharedDoc,
} from '../../lib/deliveryRebuild';
import type { DeliveryProject, PortalSettings } from '../../types/delivery';

const SECTIONS: [keyof PortalSettings, string, string][] = [
  ['plan', 'Project plan', 'Phases, tasks and progress'],
  ['documents', 'Documents', 'Only the documents you share below'],
  ['deliverables', 'Client deliverables', 'Deliverables you mark below, plus anything the client uploads'],
  ['issues', 'Open issues', 'The issue log — off by default'],
  ['meetings', 'Meetings', 'Client meetings from the project calendar'],
];

export function PortalTab({ project, canEdit }: { project: DeliveryProject; canEdit: boolean }) {
  const updateProject = useDeliveryStore((s) => s.updateProject);
  const settings = project.portalSettings;
  const toggle = (k: keyof PortalSettings) => updateProject(project.id, { portalSettings: { ...settings, [k]: !settings[k] } }).catch(alertError);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start gap-4">
          <Globe size={20} className="text-primary mt-0.5" />
          <div className="flex-1 min-w-[16rem]">
            <div className="font-bold text-ink">What the client sees</div>
            <div className="text-xs text-muted mt-0.5">Clients sign in at <a className="underline" href={PORTAL_URL} target="_blank" rel="noreferrer">{PORTAL_URL}</a> with the login you issue below.</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(PORTAL_URL); toast('Portal link copied', 'ok'); }}><Copy size={13} /> Copy link</Button>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
          {SECTIONS.map(([k, label, hint]) => (
            <label key={k} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${settings[k] ? 'border-primary/40 bg-primary/5' : 'border-line'} ${canEdit ? 'cursor-pointer' : ''}`}>
              <input type="checkbox" checked={settings[k]} disabled={!canEdit} onChange={() => toggle(k)} className="mt-0.5 accent-primary" />
              <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-[11px] text-muted">{hint}</span></span>
            </label>
          ))}
        </div>
      </Card>

      <PortalAccessCard target={{ projectId: project.id }} canEdit={canEdit} company={project.client ?? ''} />

      {(settings.documents || settings.deliverables) && <DocSharing projectId={project.id} canEdit={canEdit} />}
    </div>
  );
}

function DocSharing({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [docs, setDocs] = useState<SharedDoc[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { loadProjectDocsForSharing(projectId).then(setDocs).catch((e) => { alertError(e); setDocs([]); }); }, [projectId]);
  if (!docs) return <Card><Loader2 size={14} className="animate-spin text-muted" /></Card>;
  const shared = docs.filter((d) => d.clientVisible).length;
  const list = showAll ? docs : docs.slice(0, 25);
  const update = async (d: SharedDoc, patch: { clientVisible?: boolean; clientDeliverable?: boolean }) => {
    const next = { ...d, ...(patch.clientVisible !== undefined ? { clientVisible: patch.clientVisible } : {}), ...(patch.clientDeliverable !== undefined ? { clientDeliverable: patch.clientDeliverable, clientVisible: patch.clientDeliverable || d.clientVisible } : {}) };
    if (patch.clientVisible === false) next.clientDeliverable = false;
    setDocs((all) => (all ?? []).map((x) => (x.id === d.id ? next : x)));
    try {
      await setDocumentSharing(d.id, patch.clientVisible === false ? { clientVisible: false, clientDeliverable: false } : patch);
    } catch (e) { alertError(e); setDocs((all) => (all ?? []).map((x) => (x.id === d.id ? d : x))); }
  };
  return (
    <Card flush>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-line/60">
        <FileCheck2 size={16} className="text-muted" />
        <div className="font-bold text-ink">Shared documents <span className="text-muted font-normal tabular-nums">{shared} of {docs.length}</span></div>
        <div className="text-xs text-muted">Nothing is shared until you tick it. Client uploads are shared back automatically.</div>
      </div>
      {docs.length === 0 ? <div className="px-5 py-4 text-sm text-muted">No files on this project yet.</div> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="px-5 py-2 font-semibold">Document</th><th className="px-3 py-2 font-semibold w-28">Type</th><th className="px-3 py-2 font-semibold w-24 text-center">Shared</th><th className="px-3 py-2 font-semibold w-28 text-center">Deliverable</th></tr></thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id} className="border-t border-line/40">
                <td className="px-5 py-1.5"><span className="text-ink">{d.name}</span>{d.fromClient && <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-violet-600"><Upload size={10} /> from {d.fromClient}</span>}</td>
                <td className="px-3 py-1.5 text-xs text-muted">{d.docType ?? '—'}</td>
                <td className="px-3 py-1.5 text-center"><input type="checkbox" disabled={!canEdit} checked={d.clientVisible} onChange={() => update(d, { clientVisible: !d.clientVisible })} className="accent-primary" /></td>
                <td className="px-3 py-1.5 text-center"><input type="checkbox" disabled={!canEdit || !!d.fromClient} checked={d.clientDeliverable || !!d.fromClient} onChange={() => update(d, { clientDeliverable: !d.clientDeliverable })} className="accent-primary" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {docs.length > 25 && <button onClick={() => setShowAll(!showAll)} className="w-full py-2 text-xs text-muted hover:text-ink border-t border-line/40">{showAll ? 'Show fewer' : `Show all ${docs.length}`}</button>}
    </Card>
  );
}

/** People with a portal login for this project / concierge account. */
export function PortalAccessCard({ target, canEdit, company }: { target: { projectId?: string; conciergeAccountId?: string }; canEdit: boolean; company: string }) {
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof portalActivity>>>([]);
  const [form, setForm] = useState({ email: '', fullName: '', company });
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [reveal, setReveal] = useState(true);
  const [busy, setBusy] = useState(false);
  const key = target.projectId ?? target.conciergeAccountId;

  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([loadPortalAccess(target), portalActivity(target)]);
      setUsers(u); setActivity(a);
    } catch (e) { alertError(e); setUsers([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      const { user, password } = await grantPortalAccess(target, form);
      if (password) { setIssued({ email: user.email, password }); setReveal(true); }
      else toast(`${user.email} already had a portal login — access added`, 'ok');
      setForm({ email: '', fullName: '', company });
      await load();
    } catch (e) { alertError(e); } finally { setBusy(false); }
  };
  const reset = async (u: PortalUser) => {
    if (!window.confirm(`Issue a new password for ${u.email}? Their current password stops working.`)) return;
    const pw = generatePassword();
    try { await setPortalPassword(u.id, pw); setIssued({ email: u.email, password: pw }); setReveal(true); await load(); } catch (e) { alertError(e); }
  };

  return (
    <Card flush>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-line/60">
        <KeyRound size={16} className="text-muted" />
        <div className="font-bold text-ink">Client logins <span className="text-muted font-normal tabular-nums">{users?.length ?? ''}</span></div>
        <div className="text-xs text-muted">One login per person. Turning a person off or removing them takes effect immediately.</div>
      </div>

      {issued && (
        <div className="mx-5 mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
          <div className="font-semibold text-ink">Login for {issued.email}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="rounded bg-surface px-2 py-1 font-mono text-ink">{reveal ? issued.password : '••••-••••-••••-••••'}</code>
            <button onClick={() => setReveal(!reveal)} className="text-muted hover:text-ink">{reveal ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(`Portal: ${PORTAL_URL}\nEmail: ${issued.email}\nPassword: ${issued.password}`); toast('Login details copied', 'ok'); }}><Copy size={13} /> Copy login details</Button>
            <button onClick={() => setIssued(null)} className="ml-auto text-xs text-muted hover:text-ink">Done</button>
          </div>
          <div className="mt-1 text-[11px] text-muted">Shown once. Send it to the client securely; it can’t be looked up later — only reset.</div>
        </div>
      )}

      {users === null ? <div className="px-5 py-4"><Loader2 size={14} className="animate-spin text-muted" /></div> : users.length === 0 ? (
        <div className="px-5 py-4 text-sm text-muted">No one from the client can sign in yet.</div>
      ) : (
        <table className="w-full text-sm mt-1">
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-t border-line/40 ${u.active ? '' : 'opacity-50'}`}>
                <td className="px-5 py-2"><div className="font-semibold text-ink">{u.fullName ?? u.email}</div><div className="text-xs text-muted">{u.email}{u.company ? ` · ${u.company}` : ''}</div></td>
                <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">{u.lastLoginAt ? `Last in ${new Date(u.lastLoginAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Never signed in'}{u.lockedUntil && new Date(u.lockedUntil) > new Date() ? ' · locked' : ''}</td>
                <td className="px-5 py-2 text-right whitespace-nowrap">
                  {canEdit && (
                    <span className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => reset(u)}><KeyRound size={13} /> New password</Button>
                      <Button size="sm" variant="ghost" title={u.active ? 'Turn off this login everywhere' : 'Turn back on'} onClick={() => setPortalUserActive(u.id, !u.active).then(load).catch(alertError)}><Power size={13} /> {u.active ? 'Turn off' : 'Turn on'}</Button>
                      <Button size="sm" variant="ghost" title="Remove access to this item" onClick={() => { if (window.confirm(`Remove ${u.email}'s access here?`)) revokePortalAccess(target, u.id).then(load).catch(alertError); }}><Trash2 size={13} /></Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canEdit && (
        <form className="flex flex-wrap items-end gap-2 px-5 py-4 border-t border-line/60" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="text-xs text-muted flex-1 min-w-[12rem]">Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" placeholder="name@client.com" /></label>
          <label className="text-xs text-muted w-44">Name<input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
          <label className="text-xs text-muted w-44">Company<input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" /></label>
          <Button type="submit" disabled={busy || !form.email.trim()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Give access</Button>
        </form>
      )}

      {activity.length > 0 && (
        <div className="px-5 py-3 border-t border-line/60 text-xs text-muted">
          <div className="font-semibold mb-1">Recent portal activity</div>
          {activity.slice(0, 6).map((a, i) => (
            <div key={i}>{new Date(a.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {a.who ?? 'someone'} · {a.kind}{a.detail?.name ? ` “${a.detail.name}”` : ''}</div>
          ))}
        </div>
      )}
    </Card>
  );
}
