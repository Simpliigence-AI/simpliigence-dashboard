/**
 * ScreeningModal — 4-step recruiter-screening wizard.
 *
 *   1. Pick requisition (dropdown of open reqs on this demand page)
 *   2. Prep — JD + criteria + candidate profile (with weights)
 *   3. Questions — AI-generated screening questions grouped by criterion,
 *      recruiter can copy them / paste back the transcript
 *   4. Evaluate — AI-graded scores per criterion, evidence, next steps
 *
 * Backed by useScreeningStore; each screening persists as a row in
 * `screenings`. Recruiters can revisit past screenings from the
 * Screenings history page (routes → /screenings).
 */
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { X, Sparkles, Loader2, AlertTriangle, ArrowRight, ArrowLeft, Check, Trash2, Plus, ClipboardCopy } from 'lucide-react';
import { Button } from '../ui';
import { useScreeningStore } from '../../store/useScreeningStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { RequisitionSource, Screening, ScreeningCriterion } from '../../types/screening';
import { DEFAULT_SCREENING_CRITERIA, RECOMMENDATION_META } from '../../types/screening';

export interface ScreeningReqOption {
  id: string;
  title: string;
  accountName?: string;
  jd?: string | null;
}

type Step = 'pick' | 'prep' | 'questions' | 'evaluate';

export function ScreeningModal({
  requisitionSource,
  requisitionOptions,
  initialReqId,
  onClose,
}: {
  requisitionSource: RequisitionSource;
  requisitionOptions: ScreeningReqOption[];
  initialReqId?: string | null;
  onClose: () => void;
}) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const create = useScreeningStore((s) => s.create);
  const update = useScreeningStore((s) => s.update);
  const generateQuestions = useScreeningStore((s) => s.generateQuestions);
  const evaluate = useScreeningStore((s) => s.evaluate);
  const screenings = useScreeningStore((s) => s.screenings);

  const [step, setStep] = useState<Step>(initialReqId ? 'prep' : 'pick');
  const [reqId, setReqId] = useState<string | null>(initialReqId ?? null);
  const req = useMemo(() => requisitionOptions.find((r) => r.id === reqId) ?? null, [requisitionOptions, reqId]);

  // Prep state
  const [jd, setJd] = useState('');
  const [criteria, setCriteria] = useState<ScreeningCriterion[]>(DEFAULT_SCREENING_CRITERIA);
  const [candidateName, setCandidateName] = useState('');
  const [candidateProfile, setCandidateProfile] = useState('');

  // Active screening id — set after "Generate questions"
  const [screeningId, setScreeningId] = useState<string | null>(null);
  const current: Screening | null = useMemo(() => screenings.find((s) => s.id === screeningId) ?? null, [screenings, screeningId]);

  // Transcript for evaluation
  const [transcript, setTranscript] = useState('');

  const [busy, setBusy] = useState<null | 'generate' | 'evaluate' | 'save'>(null);
  const [err, setErr] = useState<string | null>(null);

  // When a requisition is picked, prefill its JD if we have one on record.
  useEffect(() => {
    if (req?.jd && !jd) setJd(req.jd);
  }, [req, jd]);

  async function goToQuestions() {
    if (!req || !jd.trim() || !candidateProfile.trim() || criteria.length === 0) {
      setErr('JD, at least one criterion, and candidate profile are required.');
      return;
    }
    setBusy('generate'); setErr(null);
    try {
      const created = await create({
        requisitionSource,
        requisitionId: req.id,
        requisitionTitle: req.title,
        accountName: req.accountName ?? null,
        jd,
        criteria,
        candidateProfile,
        candidateName: candidateName || null,
        createdBy: currentUser?.email ?? null,
      });
      setScreeningId(created.id);
      await generateQuestions(created.id);
      setStep('questions');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function goToEvaluate() {
    if (!screeningId) return;
    if (!transcript.trim()) { setErr('Paste the transcript or notes from the screen first.'); return; }
    setBusy('evaluate'); setErr(null);
    try {
      await update(screeningId, { transcript });
      await evaluate(screeningId);
      setStep('evaluate');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-600" />
            <div>
              <div className="text-sm font-bold text-slate-900">Screening</div>
              <div className="text-[11px] text-slate-500">
                {req ? `${req.title}${req.accountName ? ` · ${req.accountName}` : ''}` : `Pick a ${requisitionSource === 'india' ? 'India' : 'Global'} Demand requisition`}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>

        {/* Stepper */}
        <div className="px-5 pt-3 flex items-center gap-1 text-[11px]">
          {(['pick', 'prep', 'questions', 'evaluate'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-semibold ${
                step === s ? 'bg-purple-600 text-white' : (['pick','prep','questions','evaluate'].indexOf(step) > i ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600')
              }`}>{i + 1}</span>
              <span className={`capitalize ${step === s ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{s}</span>
              {i < 3 && <span className="text-slate-300 mx-1">→</span>}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {err && (
            <div className="mb-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </div>
          )}

          {step === 'pick' && (
            <PickStep options={requisitionOptions} value={reqId} onChange={setReqId} />
          )}
          {step === 'prep' && (
            <PrepStep
              jd={jd} setJd={setJd}
              criteria={criteria} setCriteria={setCriteria}
              candidateName={candidateName} setCandidateName={setCandidateName}
              candidateProfile={candidateProfile} setCandidateProfile={setCandidateProfile}
            />
          )}
          {step === 'questions' && current && (
            <QuestionsStep screening={current} transcript={transcript} setTranscript={setTranscript} />
          )}
          {step === 'evaluate' && current?.evaluation && (
            <EvaluateStep screening={current} />
          )}
        </div>

        {/* Footer nav */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <div className="text-[10px] text-slate-400">
            {current && `Saved · ${new Date(current.updatedAt).toLocaleString()}`}
          </div>
          <div className="flex items-center gap-2">
            {step === 'prep' && !initialReqId && (
              <Button variant="ghost" size="sm" onClick={() => setStep('pick')}><ArrowLeft size={12} /> Back</Button>
            )}
            {step === 'pick' && (
              <Button variant="primary" size="sm" onClick={() => reqId && setStep('prep')} disabled={!reqId}>
                Next <ArrowRight size={12} />
              </Button>
            )}
            {step === 'prep' && (
              <Button variant="primary" size="sm" onClick={goToQuestions} disabled={busy === 'generate'}>
                {busy === 'generate' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                <span className="ml-1">Generate questions</span>
              </Button>
            )}
            {step === 'questions' && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setStep('prep')}><ArrowLeft size={12} /> Back</Button>
                <Button variant="primary" size="sm" onClick={goToEvaluate} disabled={busy === 'evaluate' || !transcript.trim()}>
                  {busy === 'evaluate' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  <span className="ml-1">Score the transcript</span>
                </Button>
              </>
            )}
            {step === 'evaluate' && (
              <Button variant="primary" size="sm" onClick={onClose}><Check size={12} /> Done</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step components ── */

function PickStep({ options, value, onChange }: { options: ScreeningReqOption[]; value: string | null; onChange: (v: string | null) => void }): JSX.Element {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => `${o.title} ${o.accountName ?? ''}`.toLowerCase().includes(s));
  }, [options, q]);
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-slate-800">Which requisition are you screening for?</div>
      <input
        type="text" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search title or account…"
        className="w-full px-3 py-2 rounded border border-slate-300 text-sm"
      />
      <ul className="space-y-1 max-h-96 overflow-y-auto border border-slate-200 rounded">
        {filtered.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onChange(o.id)}
              className={`w-full text-left px-3 py-2 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${
                value === o.id ? 'bg-purple-50 border-l-2 border-l-purple-500' : ''
              }`}
            >
              <div className="text-sm font-medium text-slate-900">{o.title}</div>
              <div className="text-[11px] text-slate-500">{o.accountName || '—'}{o.jd ? ' · JD on file' : ' · no JD saved'}</div>
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="px-3 py-3 text-xs italic text-slate-500">No matching requisitions</li>}
      </ul>
    </div>
  );
}

function PrepStep({
  jd, setJd, criteria, setCriteria, candidateName, setCandidateName, candidateProfile, setCandidateProfile,
}: {
  jd: string; setJd: (v: string) => void;
  criteria: ScreeningCriterion[]; setCriteria: (v: ScreeningCriterion[]) => void;
  candidateName: string; setCandidateName: (v: string) => void;
  candidateProfile: string; setCandidateProfile: (v: string) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Job description</label>
        <textarea value={jd} onChange={(e) => setJd(e.target.value)} rows={8}
          placeholder="Paste the JD for this role."
          className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm font-mono" />
      </div>

      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider flex items-center justify-between">
          <span>Screening criteria</span>
          <button type="button"
            onClick={() => setCriteria([...criteria, { name: '', weight: 10 }])}
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-purple-700 hover:text-purple-900"
          ><Plus size={11} /> Add</button>
        </label>
        <ul className="mt-1 space-y-1.5">
          {criteria.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <input
                type="text" value={c.name}
                onChange={(e) => { const next = [...criteria]; next[i] = { ...c, name: e.target.value }; setCriteria(next); }}
                placeholder="Criterion (e.g. Development skills)"
                className="flex-1 px-2 py-1.5 rounded border border-slate-300 text-sm"
              />
              <input
                type="number" min={0} max={100}
                value={c.weight ?? 10}
                onChange={(e) => { const next = [...criteria]; next[i] = { ...c, weight: Number(e.target.value) || 0 }; setCriteria(next); }}
                title="Weight"
                className="w-16 px-2 py-1.5 rounded border border-slate-300 text-xs text-right"
              />
              <button type="button" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-rose-600 p-1" title="Remove"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
        <div className="text-[10px] text-slate-400 mt-1.5">Higher weight = more emphasis on the final score.</div>
      </div>

      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Candidate name</label>
        <input type="text" value={candidateName} onChange={(e) => setCandidateName(e.target.value)}
          placeholder="Optional — used to personalize questions"
          className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm" />
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mt-3 block">Candidate profile / résumé</label>
        <textarea value={candidateProfile} onChange={(e) => setCandidateProfile(e.target.value)} rows={10}
          placeholder="Paste the résumé, LinkedIn profile, or a summary of the candidate."
          className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm font-mono" />
      </div>
    </div>
  );
}

function QuestionsStep({ screening, transcript, setTranscript }: { screening: Screening; transcript: string; setTranscript: (v: string) => void }): JSX.Element {
  const grouped = useMemo(() => {
    const g = new Map<string, typeof screening.generatedQuestions>();
    for (const q of screening.generatedQuestions) {
      const arr = g.get(q.criterion) ?? [];
      arr.push(q);
      g.set(q.criterion, arr);
    }
    return Array.from(g.entries());
  }, [screening.generatedQuestions]);

  function copyAll() {
    const text = grouped.map(([crit, qs]) =>
      `## ${crit}\n\n${qs.map((q, i) => `${i + 1}. ${q.question}${q.why_ask ? `\n   (why: ${q.why_ask})` : ''}`).join('\n\n')}`
    ).join('\n\n---\n\n');
    void navigator.clipboard.writeText(text);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">Screening questions</div>
        <button type="button" onClick={copyAll} className="inline-flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-900">
          <ClipboardCopy size={12} /> Copy all
        </button>
      </div>

      {grouped.map(([crit, qs]) => (
        <section key={crit} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">{crit}</div>
          <ol className="space-y-2.5 list-decimal pl-5">
            {qs.map((q, i) => (
              <li key={i} className="text-sm text-slate-800">
                <div className="font-medium">{q.question}</div>
                {q.why_ask && <div className="text-[11px] text-slate-500 mt-0.5">Why: {q.why_ask}</div>}
                {q.red_flags && q.red_flags.length > 0 && (
                  <ul className="mt-1 text-[11px] text-rose-700 list-disc pl-4">
                    {q.red_flags.map((rf, j) => <li key={j}>Red flag: {rf}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}

      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
          Transcript / notes from the screen
        </label>
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={8}
          placeholder="Paste the screen transcript, or the recruiter's structured notes. AI will grade against every criterion using verbatim excerpts as evidence."
          className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm font-mono" />
      </div>
    </div>
  );
}

function EvaluateStep({ screening }: { screening: Screening }): JSX.Element {
  const evalu = screening.evaluation!;
  const rec = RECOMMENDATION_META[evalu.overall_recommendation];
  return (
    <div className="space-y-4">
      <div className={`rounded-lg border-2 p-4 ${rec.cls}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Recommendation</div>
            <div className="text-lg font-bold">{rec.label}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Overall score</div>
            <div className="text-2xl font-bold tabular-nums">{Math.round(evalu.overall_score)}</div>
          </div>
        </div>
        <div className="text-sm mt-2 leading-relaxed">{evalu.summary}</div>
      </div>

      <div>
        <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-2">Per criterion</div>
        <ul className="space-y-2">
          {evalu.per_criterion.map((c, i) => (
            <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                <div className={`text-sm font-bold tabular-nums ${c.score >= 80 ? 'text-emerald-700' : c.score >= 60 ? 'text-sky-700' : c.score >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>
                  {Math.round(c.score)}
                </div>
              </div>
              <div className="text-[11px] text-slate-600 mt-1">{c.summary}</div>
              {c.evidence.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">Evidence</div>
                  <ul className="mt-0.5 space-y-0.5 text-[11px] text-slate-700">
                    {c.evidence.map((e, j) => <li key={j} className="italic before:content-['“'] after:content-['”']">{e}</li>)}
                  </ul>
                </div>
              )}
              {c.gaps.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold text-rose-700 uppercase tracking-wider">Gaps</div>
                  <ul className="mt-0.5 space-y-0.5 text-[11px] text-slate-700 list-disc pl-4">
                    {c.gaps.map((g, j) => <li key={j}>{g}</li>)}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {evalu.next_steps && evalu.next_steps.length > 0 && (
        <div>
          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Recommended next steps</div>
          <ul className="list-disc pl-5 space-y-0.5 text-sm text-slate-800">
            {evalu.next_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
