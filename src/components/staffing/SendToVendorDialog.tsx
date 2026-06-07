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
 * On Send, we open a `mailto:` link per vendor (Phase 1 — no server-side
 * delivery yet) AND log a row to `vendor_outreach` for each. Vendors do NOT
 * see each other since each email is composed individually.
 *
 * Phase 2 (when M365/SMTP creds are available) will replace the `mailto:`
 * with an edge function that sends from hr@simpliigence.com directly.
 */
import { useMemo, useState } from 'react';
import { Send, Search, Mail, CheckSquare, Square, Sparkles, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useVendorStore } from '../../store/useVendorStore';
import type { StaffingRequisition } from '../../types/staffing';

/** Default subject line. */
function defaultSubject(req: StaffingRequisition, accountName: string): string {
  const parts = [req.title.trim(), accountName ? `(${accountName})` : '']
    .filter(Boolean).join(' ');
  return `Requirement: ${parts}`;
}

/** Default body template — replaces tokens at send time per vendor. */
function buildBody(req: StaffingRequisition, accountName: string, jd?: string, spocName?: string | null) {
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

  const foot = `\n\nKindly send 2–3 matching profiles at your earliest. Reply to this email; we will route from there.

Thanks,
Simpliigence Talent Team
hr@simpliigence.com`;

  return head + jdBlock + foot;
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
  const myEmail = (useAuthStore.getState().currentUser?.email || '').toLowerCase();
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
  const [body, setBody] = useState(buildBody(requisition, accountName, requisition.job_description ?? undefined));
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);

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

  const handleSend = async () => {
    setSending(true);
    const picked = vendors.filter((v) => selected.has(v.id));
    let count = 0;
    for (const v of picked) {
      if (!v.spocEmail) continue;
      // Each email is composed per-vendor with the SPOC's name in the greeting
      // so vendors get a personal greeting + never see each other.
      const personalBody = buildBody(requisition, accountName, requisition.job_description ?? undefined, v.spocName);
      const mailto = `mailto:${encodeURIComponent(v.spocEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(personalBody)}`;
      // Open in a new window per vendor — most mail clients honour mailto: links.
      window.open(mailto, '_blank');
      await logOutreach({
        vendorId: v.id,
        requisitionId: requisition.id,
        sentBy: myEmail,
        subject,
        bodyPreview: personalBody,
        sendStatus: 'composed',
      });
      count += 1;
      // Tiny pause between mailto opens so the browser doesn't suppress them
      await new Promise((r) => setTimeout(r, 250));
    }
    setSent(count);
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
                    return (
                      <li key={v.id}>
                        <button
                          type="button"
                          onClick={() => toggle(v.id)}
                          className={`w-full text-left px-2 py-1.5 rounded border ${
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
                              </div>
                              <div className="text-[11px] text-slate-500 inline-flex items-center gap-1 mt-0.5">
                                <Mail size={10} /> {v.spocEmail || <span className="italic">no email</span>}
                                {v.spocName && <span>· {v.spocName}</span>}
                              </div>
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
                Phase 1 sends via your default mail app (one window per vendor — they don't see each other).
                Phase 2 will send from <code className="font-mono">hr@simpliigence.com</code> via Microsoft 365.
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="text-[11px] text-slate-600">
            {sent > 0 ? (
              <span className="text-emerald-700 font-semibold">
                ✓ Opened {sent} mail draft{sent === 1 ? '' : 's'}. Outreach logged.
              </span>
            ) : (
              <>Will compose <strong className="text-slate-900">{totalPicked}</strong> one-on-one email{totalPicked === 1 ? '' : 's'}.</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={sending}
                    className="text-xs text-slate-600 hover:text-slate-900 px-3 py-2 disabled:opacity-40">
              {sent > 0 ? 'Close' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || totalPicked === 0}
              className="text-xs font-semibold bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <Send size={12} /> {sending ? 'Composing…' : `Send to ${totalPicked} vendor${totalPicked === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
