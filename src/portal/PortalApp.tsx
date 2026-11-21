/**
 * Simpliigence client portal — /portal.
 *
 * A separate, self-contained app for client contacts. It never touches the
 * internal Supabase session or stores: every call goes to the client-portal
 * edge function with the portal session token, and the function decides what
 * this person may see.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, LogOut, FolderKanban, Headset, FileText, Download, Upload, ChevronLeft, CheckCircle2, Circle, CalendarDays, AlertTriangle, Ticket, Lock } from 'lucide-react';
import wordmark from '../assets/simpliigence-wordmark.png';

const FN = `${import.meta.env.VITE_SUPABASE_URL || 'https://mhmxlubithnidopmkwgt.supabase.co'}/functions/v1/client-portal`;
const TOKEN_KEY = 'simpliigence-portal-token';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

async function call(action: string, body: Row = {}): Promise<Row> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, token, ...body }) });
  const j = await r.json().catch(() => ({ error: 'Something went wrong.' }));
  if (r.status === 401 && action !== 'login') { sessionStorage.removeItem(TOKEN_KEY); window.dispatchEvent(new Event('portal-signout')); }
  if (!r.ok) throw new Error(j.error ?? 'Something went wrong.');
  return j;
}

const fmt = (d?: string | null) => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const size = (n?: number | null) => (!n ? '' : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default function PortalApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  useEffect(() => {
    document.title = 'Simpliigence · Client Portal';
    const off = () => setToken(null);
    window.addEventListener('portal-signout', off);
    return () => window.removeEventListener('portal-signout', off);
  }, []);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {token ? <Home onSignOut={() => { void call('logout').finally(() => { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }); }} /> : <SignIn onIn={(t) => { sessionStorage.setItem(TOKEN_KEY, t); setToken(t); }} />}
    </div>
  );
}

function SignIn({ onIn }: { onIn: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try { const r = await call('login', { email, password }); onIn(r.token); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
      }}>
        <img src={wordmark} alt="Simpliigence" className="h-8 mb-6" />
        <h1 className="text-xl font-bold">Client portal</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">Sign in with the login your Simpliigence team sent you.</p>
        <label className="block text-xs font-semibold text-slate-600">Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500/40" required />
        </label>
        <label className="block text-xs font-semibold text-slate-600 mt-3">Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-500/40" required />
        </label>
        {err && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        <button disabled={busy} className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Sign in
        </button>
        <p className="mt-4 text-[11px] text-slate-400">Forgot your password? Ask your Simpliigence project manager for a new one.</p>
      </form>
    </div>
  );
}

function Home({ onSignOut }: { onSignOut: () => void }) {
  const [me, setMe] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  useEffect(() => { call('me').then((m) => { setMe(m); if (m.items?.length === 1) setOpen(m.items[0]); }).catch((e) => setErr(e.message)); }, []);
  return (
    <>
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl flex items-center gap-4 px-4 py-3">
          <img src={wordmark} alt="Simpliigence" className="h-6" />
          <span className="text-sm font-semibold text-slate-500">Client portal</span>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {me && <span className="text-slate-600">{me.name ?? me.email}{me.company ? ` · ${me.company}` : ''}</span>}
            <button onClick={onSignOut} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"><LogOut size={15} /> Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {err && <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>}
        {!me && !err && <div className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
        {me && !open && (
          <>
            <h1 className="text-2xl font-bold mb-1">Welcome{me.name ? `, ${String(me.name).split(' ')[0]}` : ''}</h1>
            <p className="text-slate-500 mb-6">Your projects and services with Simpliigence.</p>
            {me.items.length === 0 ? <p className="text-slate-500">Nothing has been shared with you yet.</p> : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {me.items.map((it: Row) => (
                  <button key={it.kind + it.id} onClick={() => setOpen(it)} className="text-left rounded-2xl bg-white p-5 ring-1 ring-slate-200 hover:ring-blue-400 hover:shadow-sm transition">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {it.kind === 'project' ? <FolderKanban size={14} /> : <Headset size={14} />} {it.kind === 'project' ? 'Project' : 'Managed services'}
                    </div>
                    <div className="mt-2 text-lg font-bold">{it.name}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {me && open && <ItemView item={open} onBack={me.items.length > 1 ? () => setOpen(null) : undefined} />}
      </main>
    </>
  );
}

type Tab = 'plan' | 'documents' | 'deliverables' | 'issues' | 'meetings' | 'tickets';

function ItemView({ item, onBack }: { item: Row; onBack?: () => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab | null>(null);
  const [now] = useState(() => Date.now());
  const load = useCallback(() => call('view', { kind: item.kind, id: item.id }).then(setV).catch((e) => setErr(e.message)), [item]);
  useEffect(() => { void load(); }, [load]);
  const tabs = useMemo(() => {
    if (!v) return [] as [Tab, string][];
    const s = v.sections ?? {};
    const all: [Tab, string, boolean][] = [
      ['plan', 'Project plan', !!s.plan], ['tickets', 'Tickets', !!s.tickets], ['documents', 'Documents', !!s.documents],
      ['deliverables', 'Deliverables & uploads', !!s.deliverables], ['issues', 'Open issues', !!s.issues], ['meetings', 'Meetings', !!s.meetings],
    ];
    return all.filter(([, , on]) => on).map(([k, l]) => [k, l] as [Tab, string]);
  }, [v]);
  const active = tab ?? tabs[0]?.[0] ?? null;

  if (err) return <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>;
  if (!v) return <div className="flex items-center gap-2 text-slate-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>;

  const tasks: Row[] = v.tasks ?? [];
  const done = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {onBack && <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ChevronLeft size={15} /> All items</button>}
      <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{v.kind === 'project' ? 'Project' : 'Managed services'}</div>
        <h1 className="text-2xl font-bold mt-1">{v.name}</h1>
        {v.kind === 'project' && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat label="Progress" value={tasks.length ? `${pct}%` : '—'} sub={tasks.length ? `${done} of ${tasks.length} tasks` : undefined} />
            <Stat label="Start" value={fmt(v.startDate)} />
            <Stat label="Target end" value={fmt(v.endDate)} />
            <Stat label="Project manager" value={v.pm ?? '—'} />
          </div>
        )}
        {v.kind === 'concierge' && v.tickets && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Stat label="Open tickets" value={String(v.tickets.filter((t: Row) => !/closed|resolved/i.test(t.status ?? '')).length)} />
            <Stat label="Resolved (90 days)" value={String(v.tickets.filter((t: Row) => t.resolved && now - new Date(t.resolved).getTime() < 90 * 864e5).length)} />
          </div>
        )}
      </div>

      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200 w-fit">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${active === k ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      )}

      {active === 'plan' && <Plan tasks={tasks} />}
      {active === 'documents' && <Docs item={item} docs={v.documents ?? []} empty="No documents have been shared yet." />}
      {active === 'deliverables' && <Deliverables item={item} docs={v.deliverables ?? []} onUploaded={load} />}
      {active === 'issues' && <Panel>{(v.issues ?? []).length === 0 ? <Empty text="No open issues." /> : (v.issues as Row[]).map((i) => (
        <div key={i.id} className="flex items-start gap-3 px-5 py-3 border-t border-slate-100 first:border-0"><AlertTriangle size={15} className="mt-0.5 text-amber-500" /><div className="flex-1"><div>{i.description}</div><div className="text-xs text-slate-500 mt-0.5 capitalize">{i.criticality}{i.due_date ? ` · due ${fmt(i.due_date)}` : ''}</div></div></div>
      ))}</Panel>}
      {active === 'meetings' && <Panel>{(v.meetings ?? []).length === 0 ? <Empty text="No meetings in the calendar." /> : (v.meetings as Row[]).map((m) => (
        <div key={m.id} className={`flex items-center gap-3 px-5 py-3 border-t border-slate-100 first:border-0 ${new Date(m.start) < new Date() ? 'text-slate-400' : ''}`}><CalendarDays size={15} /><div className="flex-1">{m.subject}</div><div className="text-sm tabular-nums">{new Date(m.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div></div>
      ))}</Panel>}
      {active === 'tickets' && <Panel>{(v.tickets ?? []).length === 0 ? <Empty text="No tickets yet." /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="px-5 py-2 font-semibold">Ticket</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 font-semibold">Opened</th><th className="px-3 py-2 font-semibold">Updated</th></tr></thead>
          <tbody>{(v.tickets as Row[]).map((t) => (
            <tr key={t.id} className="border-t border-slate-100"><td className="px-5 py-2"><span className="inline-flex items-center gap-2"><Ticket size={13} className="text-slate-400" />{t.number ? `#${t.number} ` : ''}{t.subject}</span></td><td className="px-3 py-2"><span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold">{t.status}</span></td><td className="px-3 py-2 text-slate-500">{fmt(t.opened)}</td><td className="px-3 py-2 text-slate-500">{fmt(t.updated)}</td></tr>
          ))}</tbody>
        </table>
      )}</Panel>}
    </div>
  );
}

function Plan({ tasks }: { tasks: Row[] }) {
  const phases = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const t of tasks) { const k = (t.phase ?? '').trim() || 'General'; (m.get(k) ?? m.set(k, []).get(k)!).push(t); }
    return [...m].map(([name, items]) => {
      const starts = items.map((t) => t.start).filter(Boolean).sort();
      const ends = items.map((t) => t.end).filter(Boolean).sort();
      return { name, items, start: starts[0], end: ends.at(-1), done: items.filter((t) => t.done).length };
    });
  }, [tasks]);
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  if (!tasks.length) return <Panel><Empty text="The plan hasn’t been published yet." /></Panel>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-3">
      {phases.map((p) => {
        const pct = Math.round((p.done / p.items.length) * 100);
        const late = p.items.some((t) => !t.done && t.end && t.end < today);
        return (
          <div key={p.name} className="rounded-2xl bg-white ring-1 ring-slate-200">
            <button onClick={() => setOpenPhase(openPhase === p.name ? null : p.name)} className="w-full flex flex-wrap items-center gap-4 px-5 py-4 text-left">
              <span className="font-bold">{p.name}</span>
              <span className="text-xs text-slate-500">{fmt(p.start)} – {fmt(p.end)}</span>
              {pct === 100 ? <span className="text-xs font-semibold text-emerald-600">Complete</span> : late ? <span className="text-xs font-semibold text-amber-600">Behind</span> : null}
              <span className="ml-auto flex items-center gap-2 text-xs text-slate-500 tabular-nums">{p.done}/{p.items.length}
                <span className="w-32 h-2 rounded-full bg-slate-100 overflow-hidden"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></span>
              </span>
            </button>
            {openPhase === p.name && (
              <ul className="border-t border-slate-100">
                {p.items.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-2 text-sm border-t border-slate-50 first:border-0">
                    {t.done ? <CheckCircle2 size={15} className="text-emerald-500" /> : <Circle size={15} className="text-slate-300" />}
                    <span className={`flex-1 ${t.done ? 'text-slate-400 line-through' : ''}`}>{t.name}</span>
                    <span className="text-xs text-slate-500 tabular-nums">{t.end ? fmt(t.end) : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Docs({ item, docs, empty }: { item: Row; docs: Row[]; empty: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (d: Row) => {
    setBusy(d.id);
    try { const r = await call('file', { kind: item.kind, id: item.id, docId: d.id }); window.open(r.url, '_blank', 'noopener'); } catch (e) { alert((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <Panel>
      {docs.length === 0 ? <Empty text={empty} /> : docs.map((d) => (
        <div key={d.id} className="flex items-center gap-3 px-5 py-3 border-t border-slate-100 first:border-0">
          <FileText size={16} className="text-slate-400" />
          <div className="flex-1 min-w-0"><div className="truncate font-medium">{d.name}</div><div className="text-xs text-slate-500">{[d.type, fmt(d.at), size(d.size), d.fromClient ? `uploaded by ${d.fromClient}` : ''].filter(Boolean).join(' · ')}</div></div>
          <button onClick={() => open(d)} disabled={busy === d.id} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-blue-600 hover:bg-blue-50">
            {busy === d.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download
          </button>
        </div>
      ))}
    </Panel>
  );
}

function Deliverables({ item, docs, onUploaded }: { item: Row; docs: Row[]; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setMsg('');
    try {
      for (const f of Array.from(files)) {
        const u = await call('upload-url', { kind: item.kind, id: item.id, filename: f.name, size: f.size });
        const put = await fetch(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream', 'x-upsert': 'false' }, body: f });
        if (!put.ok) throw new Error(`Upload of ${f.name} failed`);
        await call('upload-done', { kind: item.kind, id: item.id, path: u.path, filename: f.name, size: f.size, mime: f.type });
      }
      setMsg(`${files.length} file${files.length === 1 ? '' : 's'} uploaded — your Simpliigence team can see ${files.length === 1 ? 'it' : 'them'} now.`);
      onUploaded();
    } catch (e) { setMsg((e as Error).message); } finally { setUploading(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-6 text-center"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(e.dataTransfer.files); }}>
        <Upload size={22} className="mx-auto text-slate-400" />
        <div className="mt-2 text-sm font-semibold">Send files to your Simpliigence team</div>
        <div className="text-xs text-slate-500">Drag files here or choose them — up to 50 MB each</div>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
        <button onClick={() => input.current?.click()} disabled={uploading} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose files
        </button>
        {msg && <div className="mt-3 text-sm text-slate-600">{msg}</div>}
      </div>
      <Docs item={item} docs={docs} empty="No deliverables yet." />
    </div>
  );
}

const Panel = ({ children }: { children: React.ReactNode }) => <div className="rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">{children}</div>;
const Empty = ({ text }: { text: string }) => <div className="px-5 py-6 text-sm text-slate-500">{text}</div>;
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-0.5 text-lg font-bold">{value}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>;
}
