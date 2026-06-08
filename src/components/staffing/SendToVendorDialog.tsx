/**
 * Send-to-Vendor dialog — fires from the India Demand requisition row.
 *
 * Lists vendors from the Vendors database. Vendors whose `skills` overlap
 * with the requisition's inferred skills are pre-selected + bubbled to the
 * top so the recruiter doesn't have to hunt. Multi-select checkboxes.
 *
 * The user can edit the subject + body. Body pre-fills with the requisition
 * title, account, and (if generated) the full Markdown JD that lives on
 * `requisition.job_description`.
 *
 * Phase 2 (current): Send fires the `send-vendor-email` edge function per
 * vendor, which delivers via Microsoft Graph using the HR Portal Azure app.
 * The From is a shared mailbox (hr@simpliigence.com, server-controlled);
 * Reply-To is the signed-in recruiter so vendor replies route to them.
 * Each vendor sees a personalised email (their SPOC name in the greeting)
 * and never sees other vendors. The signature in the body shows the
 * recruiter's identity. Outcome per vendor is shown inline as ✓ sent /
 * ✗ failed (with reason).
 */
import { useMemo, useState } from 'react';
import { Send, Search, Mail, CheckSquare, Square, Sparkles, AlertCircle, Check, X as XIcon, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useVendorStore } from '../../store/useVendorStore';
import { db } from '../../lib/supabaseSync';
import type { StaffingRequisition } from '../../types/staffing';

/** Per-vendor send result tracked in dialog state. */
type SendResult = { status: 'sending' } | { status: 'sent'; id: string } | { status: 'failed'; error: string };

/** Default subject line. */
function defaultSubject(req: StaffingRequisition, accountName: string): string {
  const parts = [req.title.trim(), accountName ? `(${accountName})` : '']
    .filter(Boolean).join(' ');
  return `Requirement: ${parts}`;
}

/** Default body template — replaces tokens at send time per vendor.
 *  The footer signature uses the *signed-in recruiter's* identity so
 *  vendors know who they're actually corresponding with (and replies
 *  land in the right inbox). */
function buildBody(
  req: StaffingRequisition,
  accountName: string,
  jd: string | undefined,
  spocName: string | null | undefined,
  sender: { name: string; email: string },
) {
  const greet = spocName ? `Hi ${spocName.split(' ')[0]},` : 'Hi,';
  const head = `${greet}

We have an open requirement and would like to receive your best matching profiles.

REQUISITION DETAILS
• Role: ${req.title}
• Account: ${accountName || '—'}
• Department: ${req.department || '—'}
• Location: India
• Expected closure: ${req.expected_closure || req.close_by_date || '—'}
• Open positions: ${req.new_positions || 1}`;

  const jdBlock = jd?.trim()
    ? `\n\nJOB DESCRIPTION\n${jd.trim()}`
    : `\n\n(Please reply to this email — we will share the detailed JD on request.)`;

  const foot = `\n\nKindly send 2–3 matching profiles at your earliest. Reply directly to this email and they'll come straight to me.

Thanks,
${sender.name}
Simpliigence Talent Team
${sender.email}`;

  return head + jdBlock + foot;
}

/** Turn an email like "raghu.seetharam@simpliigence.com" into "Raghu Seetharam".
 *  Used only as a fallback when the user has no `fullName` on their profile. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] || '';
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Extract probable skills from a requisition title — quick heuristic. */
function inferSkillsFromTitle(title: string, presets: string[]): string[] {
  const t = title.toLowerCase();
  return presets.filter((s) => t.includes(s.toLowerCase()));
}

interface Props {
  requisition: StaffingRequisition;
  accountName: string;
  onClose: () => void;
}

export function SendToVendorDialog({ requisition, accountName, onClose }: Props) {
  const me = useAuthStore.getState().currentUser;
  const myEmail = (me?.email || '').toLowerCase();
  const myName = (me?.fullName?.trim()) || (myEmail ? nameFromEmail(myEmail) : 'Simpliigence Talent Team');
  // Vendor reply-to / From identity. We default to the signed-in recruiter
  // so vendor responses come straight to them — not a shared alias.
  const sender = { name: myName, email: myEmail };
  const { vendors, logOutreach } = useVendorStore();

  // Inferred skills from the req title — used to suggest vendors
  const inferredSkills = useMemo(() => {
    const presets = Array.from(new Set(vendors.flatMap((v) => v.skills)));
    return inferSkillsFromTitle(requisition.title, presets);
  }, [requisition.title, vendors]);

  // Active vendors only, scored + sorted by skill match
  const ranked = useMemo(() => {
    const active = vendors.filter((v) => v.active && v.spocEmail);
    const withScore = active.map((v) => {
      const matches = v.skills.filter((s) => inferredSkills.includes(s)).length;
      return { v, matches };
    });
    withScore.sort((a, b) => b.matches - a.matches || a.v.companyName.localeCompare(b.v.companyName));
    return withScore;
  }, [vendors, inferredSkills]);

  // Default-select vendors with at least one matching skill
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const r of ranked) if (r.matches > 0) s.add(r.v.id);
    return s;
  });
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState(defaultSubject(requisition, accountName));
  const [body, setBody] = useState(buildBody(requisition, accountName, requisition.job_description ?? undefined, null, sender));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);
  /** vendorId → result of the most recent send attempt. */
  const [results, setResults] = useState<Record<string, SendResult>>({});

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter(({ v }) => {
      const hay = `${v.companyName} ${v.spocName ?? ''} ${v.spocEmail ?? ''} ${v.skills.join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [ranked, q]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === visible.length) setSelected(new Set());
    else setSelected(new Set(visible.map((r) => r.v.id)));
  };

  /** Send each picked vendor an email via the send-vendor-email edge function.
   *  Per-vendor result lands in `results` so the row can render ✓ / ✗ inline.
   *  Outreach log row gets the actual send_status ('sent' or 'bounced') so the
   *  Vendors page activity feed reflects reality, not just composition. */
  const handleSend = async () => {
    setSending(true);
    const picked = vendors.filter((v) => selected.has(v.id));
    let successCount = 0;

    for (const v of picked) {
      if (!v.spocEmail) {
        setResults((s) => ({ ...s, [v.id]: { status: 'failed', error: 'No SPOC email on this vendor' } }));
        continue;
      }
      setResults((s) => ({ ...s, [v.id]: { status: 'sending' } }));

      const personalBody = buildBody(requisition, accountName, requisition.job_description ?? undefined, v.spocName, sender);

      // eslint-disable-next-line no-await-in-loop
      const res = await db.sendVendorEmail({
        to: v.spocEmail,
        subject,
        body: personalBody,
        // Sent via Microsoft Graph using the HR Portal Azure app. The actual
        // From mailbox is fixed server-side (GRAPH_SENDER_MAILBOX, currently
        // hr@simpliigence.com). We only pass the per-call display name + the
        // recruiter's email as Reply-To so vendor replies route to them.
        fromName: 'Simpliigence Talent',
        replyTo: myEmail || undefined,
      });

      if (res.ok) {
        setResults((s) => ({ ...s, [v.id]: { status: 'sent', id: res.id } }));
        // eslint-disable-next-line no-await-in-loop
        await logOutreach({
          vendorId: v.id,
          requisitionId: requisition.id,
          sentBy: myEmail,
          subject,
          bodyPreview: personalBody,
          sendStatus: 'sent',
        });
        successCount += 1;
      } else {
        setResults((s) => ({ ...s, [v.id]: { status: 'failed', error: res.error } }));
        // eslint-disable-next-line no-await-in-loop
        await logOutreach({
          vendorId: v.id,
          requisitionId: requisition.id,
          sentBy: myEmail,
          subject,
          bodyPreview: personalBody,
          sendStatus: 'bounced',
        });
      }
    }

    setSent(successCount);
    setSending(false);
  };

  const totalPicked = selected.size;
  const noEmailCount = ranked.filter((r) => !r.v.spocEmail).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={sending ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Send size={14} className="text-primary" />
              Send requisition to vendors
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5 truncate">
              <strong>{requisition.title}</strong> · {accountName || '—'}
              {inferredSkills.length > 0 && <span className="ml-2">· detected skills: {inferredSkills.join(', ')}</span>}
            </div>
          </div>
          <button onClick={onClose} disabled={sending} className="text-slate-400 hover:text-slate-700 text-xl leading-none disabled:opacity-40">×</button>
        </div>

        {/* Body — two columns: vendor picker (left), email preview (right) */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x divide-slate-100">

            {/* Vendor picker */}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={12} className="text-amber-500" />
                <div className="text-[11px] text-slate-700">
                  <strong className="text-amber-700">{ranked.filter((r) => r.matches > 0).length} skill-matched</strong> vendor(s) pre-selected based on the requisition title.
                </div>
              </div>
              <div className="relative mb-2">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filter vendors…"
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={toggleAll}
                        className="text-[11px] text-primary font-semibold inline-flex items-center gap-1">
                  {selected.size === visible.length ? <CheckSquare size={11} /> : <Square size={11} />}
                  {selected.size === visible.length ? 'Unselect all visible' : 'Select all visible'}
                </button>
                <span className="text-[11px] text-slate-500">{totalPicked} selected · {ranked.length} active vendors</span>
              </div>
              {noEmailCount > 0 && (
                <div className="mb-2 text-[10px] text-amber-700 inline-flex items-center gap-1">
                  <AlertCircle size={10} /> {noEmailCount} vendor(s) skipped — no SPOC email on file.
                </div>
              )}
              <ul className="space-y-1 max-h-[55vh] overflow-y-auto pr-1">
                {visible.length === 0 ? (
                  <li className="text-xs text-slate-500 italic text-center py-6">
                    No active vendors match. Add vendors on the <strong>/vendors</strong> page first.
                  </li>
                ) : (
                  visible.map(({ v, matches }) => {
                    const checked = selected.has(v.id);
                    const result = results[v.id];
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => toggle(v.id)}
                          disabled={sending}
                          className={`w-full text-left px-2 py-1.5 rounded border disabled:cursor-default ${
                            checked ? 'border-primary bg-primary/5' : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 ${checked ? 'text-primary' : 'text-slate-300'}`}>
                              {checked ? <CheckSquare size={14} /> : <Square size={14} />}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-xs font-semibold text-slate-900 truncate">{v.companyName}</span>
                                {matches > 0 && (
                                  <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full">
                                    {matches} skill match{matches === 1 ? '' : 'es'}
                                  </span>
                                )}
                                {result?.status === 'sending' && (
                                  <span className="text-[10px] text-sky-700 inline-flex items-center gap-1">
                                    <Loader2 size={10} className="animate-spin" /> sending…
                                  </span>
                                )}
                                {result?.status === 'sent' && (
                                  <span className="text-[10px] text-emerald-700 font-semibold inline-flex items-center gap-1">
                                    <Check size={10} /> sent
                                  </span>
                                )}
                                {result?.status === 'failed' && (
                                  <span className="text-[10px] text-red-700 font-semibold inline-flex items-center gap-1" title={result.error}>
                                    <XIcon size={10} /> failed
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 inline-flex items-center gap-1 mt-0.5">
                                <Mail size={10} /> {v.spocEmail || <span className="italic">no email</span>}
                                {v.spocName && <span>· {v.spocName}</span>}
                              </div>
                              {result?.status === 'failed' && (
                                <div className="text-[10px] text-red-700 italic mt-0.5 truncate" title={result.error}>
                                  {result.error}
                                </div>
                              )}
                              {v.skills.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {v.skills.slice(0, 6).map((s) => (
                                    <span key={s}
                                          className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                            inferredSkills.includes(s)
                                              ? 'bg-amber-100 text-amber-800 font-semibold'
                                              : 'bg-slate-100 text-slate-600'
                                          }`}>
                                      {s}
                                    </span>
                                  ))}
                                  {v.skills.length > 6 && <span className="text-[9px] text-slate-400">+{v.skills.length - 6}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>

            {/* Email preview / template */}
            <div className="p-5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Subject</div>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3"
              />
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Body (sent per-vendor; greeting auto-personalised)</div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={20}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              />
              <div className="text-[10px] text-slate-400 mt-1.5">
                Each vendor gets a separately addressed email sent via Microsoft Graph as{' '}
                <code className="font-mono">Simpliigence Talent &lt;hr@simpliigence.com&gt;</code>.
                Reply-To is <code className="font-mono">{myEmail || 'your inbox'}</code> — vendor replies route to you, not hr@.
                Copy lands in hr@'s Outlook Sent Items automatically. Send outcome shows ✓ / ✗ per vendor below.
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="text-[11px] text-slate-600">
            {(() => {
              const failedCount = Object.values(results).filter((r) => r.status === 'failed').length;
              if (sending) return <>Sending {Object.values(results).filter((r) => r.status === 'sending').length} of {totalPicked}…</>;
              if (sent === 0 && failedCount === 0) {
                return <>Will send <strong className="text-slate-900">{totalPicked}</strong> separately addressed email{totalPicked === 1 ? '' : 's'}.</>;
              }
              return (
                <span>
                  <span className="text-emerald-700 font-semibold">✓ {sent} sent</span>
                  {failedCount > 0 && <span className="text-red-700 font-semibold ml-2">· {failedCount} failed</span>}
                  <span className="text-slate-500"> · outreach logged</span>
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={sending}
                    className="text-xs text-slate-600 hover:text-slate-900 px-3 py-2 disabled:opacity-40">
              {sent > 0 || Object.keys(results).length > 0 ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || totalPicked === 0}
              className="text-xs font-semibold bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <Send size={12} /> {sending ? 'Sending…' : `Send to ${totalPicked} vendor${totalPicked === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
