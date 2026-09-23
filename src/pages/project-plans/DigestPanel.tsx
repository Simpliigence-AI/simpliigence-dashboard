/**
 * Email digest settings and preview (admins). The daily PM digest and the
 * Monday portfolio digest are sent by the delivery-digest edge function on
 * a pg_cron schedule; this panel turns them on/off, sets the recipients and
 * lets you see — or send yourself — exactly what would go out.
 */
import { useEffect, useState } from 'react';
import { Loader2, Eye, Send } from 'lucide-react';
import { Drawer, Button } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/useAuthStore';
import { alertError, toast } from '../../lib/planToast';
import { Field, inputClass } from './planUi';

interface Mail { to: string; subject: string; html: string }

async function callDigest(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; emails?: Mail[]; unmatched?: string[]; sent?: string[]; failed?: string[] }>('delivery-digest', { body });
  if (error || !data?.ok) {
    let msg = data?.error ?? error?.message ?? 'Digest failed.';
    const ctx = (error as { context?: Response } | null)?.context;
    if (ctx && typeof ctx.json === 'function') { try { msg = (await ctx.json()).error ?? msg; } catch { /* keep */ } }
    throw new Error(msg);
  }
  return data;
}

export function DigestPanel({ onClose }: { onClose: () => void }) {
  const me = useAuthStore((s) => s.currentUser?.email ?? '');
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [preview, setPreview] = useState<{ emails: Mail[]; unmatched: string[] } | null>(null);
  const [mode, setMode] = useState<'daily' | 'portfolio'>('daily');
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(0);

  useEffect(() => {
    let live = true;
    void supabase.from('delivery_settings').select('key, value').then(({ data, error }) => {
      if (!live) return;
      if (error) { alertError(new Error(error.message.includes('does not exist') ? 'Digest needs database update 036.' : error.message)); setSettings({}); return; }
      setSettings(Object.fromEntries((data ?? []).map((r) => [r.key, r.value ?? ''])));
    });
    return () => { live = false; };
  }, []);

  const save = async (key: string, value: string) => {
    const { error } = await supabase.from('delivery_settings').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    setSettings((s) => ({ ...(s ?? {}), [key]: value }));
  };

  return (
    <Drawer open onClose={onClose} title="Email digest" width="max-w-3xl">
      {!settings ? <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div> : (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            Every morning (08:30 New York / 18:00 India) each PM gets one email listing what needs them: change requests waiting on sign-off, out-of-scope client requests nobody has acted on, high/critical issues, late tasks, and on Thursday/Friday a missing check-in. PMs with nothing waiting get nothing. On Mondays the portfolio summary goes to the addresses below.
          </p>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={settings.digest_enabled === 'true'} onChange={(e) => save('digest_enabled', e.target.checked ? 'true' : 'false').catch(alertError)} />
            Send the digests automatically
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Flag change requests pending longer than (days)">
              <input type="number" min={1} defaultValue={settings.digest_cr_stale_days ?? '3'} onBlur={(e) => save('digest_cr_stale_days', String(Math.max(1, Number(e.target.value) || 3))).catch(alertError)} className={inputClass} />
            </Field>
            <Field label="Monday portfolio digest to" hint="Comma-separated.">
              <input defaultValue={settings.portfolio_digest_to ?? ''} onBlur={(e) => save('portfolio_digest_to', e.target.value.trim()).catch(alertError)} className={inputClass} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-4">
            <select value={mode} onChange={(e) => { setMode(e.target.value as 'daily' | 'portfolio'); setPreview(null); }} className="rounded-lg border border-line px-2 py-2 text-sm">
              <option value="daily">Daily PM digest</option>
              <option value="portfolio">Monday portfolio digest</option>
            </select>
            <Button variant="secondary" disabled={!!busy} onClick={async () => {
              setBusy('preview');
              try { const d = await callDigest({ mode, dryRun: true }); setPreview({ emails: d.emails ?? [], unmatched: d.unmatched ?? [] }); setOpen(0); }
              catch (e) { alertError(e); } finally { setBusy(null); }
            }}>{busy === 'preview' ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview</Button>
            <Button variant="ghost" disabled={!!busy || !me} onClick={async () => {
              setBusy('test');
              try { const d = await callDigest({ mode, onlyTo: me }); toast(d.sent?.length ? `Sent ${d.sent.length} email${d.sent.length === 1 ? '' : 's'} to ${me}` : 'Nothing to send today', 'ok'); if (d.failed?.length) alertError(new Error(d.failed.join('; '))); }
              catch (e) { alertError(e); } finally { setBusy(null); }
            }}>{busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send all to me as a test</Button>
          </div>

          {preview && (
            <div className="space-y-3">
              {preview.unmatched.length > 0 && (
                <p className="text-xs text-gold">No Dashboard user matches the PM on: {preview.unmatched.join('; ')}. Set the PM on each project’s page.</p>
              )}
              {preview.emails.length === 0 ? <p className="text-sm text-muted">Nothing would be sent right now.</p> : (
                <>
                  <div className="flex flex-wrap gap-1">
                    {preview.emails.map((m, i) => (
                      <button key={i} onClick={() => setOpen(i)} className={`px-2 py-1 rounded text-xs font-semibold ${open === i ? 'bg-ink text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{m.to}</button>
                    ))}
                  </div>
                  <div className="text-sm"><span className="text-muted">Subject:</span> <span className="font-semibold">{preview.emails[open]?.subject}</span></div>
                  <iframe title="Digest preview" sandbox="" srcDoc={preview.emails[open]?.html} className="w-full h-[28rem] rounded-lg border border-line bg-white" />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
