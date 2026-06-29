// @ts-nocheck
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Users, Plus, Trash2, Pencil, Building2, ChevronDown, ChevronRight,
  Globe, TrendingUp, CheckCircle, AlertTriangle, Clock, Brain,
  Sparkles, Loader2, Save, RefreshCw,
  DollarSign, Lock, Unlock, Flame, Activity,
} from 'lucide-react';
import { useUSStaffingStore } from '../store/useUSStaffingStore';
import { useSalesPlanStore, normalizeAccountName, type AccountInsight } from '../store/useSalesPlanStore';
import { Sensitive } from '../components/Sensitive';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, StatusBadge } from '../components/ui';
import type { USStaffingStage, AccountCategory } from '../types/usStaffing';
import { US_STAGE_COLORS } from '../types/usStaffing';
import { db } from '../lib/supabaseSync';

// Sales-plan urgency thresholds, mirrored from IndiaStaffingPage.
const URGENT_UNSECURED = 250_000;
const URGENT_PCT_LOCKED = 0.4;

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toFixed(0)}`;
}

/* —— Editable Cell Component —— */
function EditableCell({ value, onSave, type = 'text', options, className = '', displayContent }: {
  value: string | number;
  onSave: (val: string | number) => void;
  type?: 'text' | 'number' | 'select' | 'textarea';
  options?: string[];
  className?: string;
  displayContent?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current && type !== 'select') inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const final = type === 'number' ? Number(draft) : draft;
    if (final !== value) onSave(final);
    setEditing(false);
  };

  const cancel = () => { setDraft(value); setEditing(false); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') commit();
    if (e.key === 'Escape') cancel();
  };

  if (!editing) {
    return (
      <div
        className={`group cursor-pointer rounded px-1 -mx-1 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all min-h-[24px] flex items-center ${className}`}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        {displayContent || <span>{value || '\u00A0'}</span>}
        <Pencil size={10} className="ml-1 opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </div>
    );
  }

  if (type === 'select' && options) {
    return (
      <select ref={inputRef as any} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (type === 'textarea') {
    return (
      <textarea ref={inputRef as any} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
        className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[48px]" />
    );
  }

  return (
    <input ref={inputRef as any} type={type} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
      className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400" />
  );
}

/* —— Constants —— */
const ALL_STAGES: USStaffingStage[] = ['New','Sourcing','Profiles Shared','Interview','Shortlisted','Client Round','Closed/Selected','Onboarding','On Hold','Cancelled'];
const CATEGORIES: AccountCategory[] = ['MSP', 'SI'];

/* —— Main Component —— */
export default function USStaffingPage() {
  const { accounts, requisitions, addAccount, removeAccount, addRequisition, updateRequisition, removeRequisition } = useUSStaffingStore();

  const [activeTab, setActiveTab] = useState<'all' | 'forecast'>('all');
  const [showAddReq, setShowAddReq] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [filterStage, setFilterStage] = useState<string>('All');
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  // ── JD generator state (US side; mirror of India Demand) ──
  const [jdReqId, setJdReqId] = useState<string | null>(null);
  const [jdText, setJdText] = useState('');
  const [jdState, setJdState] = useState<'idle' | 'loading' | 'ready' | 'saving' | 'error'>('idle');
  const [jdError, setJdError] = useState<string | null>(null);
  const [jdGeneratedAt, setJdGeneratedAt] = useState<string | null>(null);
  const [jdCachedFromDb, setJdCachedFromDb] = useState(false);
  const [jdDirty, setJdDirty] = useState(false);

  const openJdDrawer = useCallback(async (reqId: string, opts: { regenerate?: boolean } = {}) => {
    setJdReqId(reqId);
    setJdState('loading');
    setJdError(null);
    setJdDirty(false);
    try {
      const res = await db.generateUsJobDescription(reqId, !!opts.regenerate);
      if (res.ok) {
        setJdText(res.jobDescription);
        setJdGeneratedAt(res.generatedAt);
        setJdCachedFromDb(res.cached);
        setJdState('ready');
      } else {
        setJdError(res.error); setJdState('error');
      }
    } catch (e) { setJdError((e as Error).message); setJdState('error'); }
  }, []);

  const closeJdDrawer = () => { setJdReqId(null); setJdText(''); setJdState('idle'); setJdError(null); setJdDirty(false); };
  const saveJd = async () => {
    if (!jdReqId) return;
    setJdState('saving');
    try {
      const r = await db.saveUsJobDescription(jdReqId, jdText);
      if (!r.ok) { setJdError(r.error || 'Save failed'); setJdState('error'); return; }
      setJdGeneratedAt(new Date().toISOString()); setJdCachedFromDb(true); setJdDirty(false); setJdState('ready');
    } catch (e) { setJdError((e as Error).message); setJdState('error'); }
  };
  const copyJd = async () => { try { await navigator.clipboard.writeText(jdText); } catch { /* ignore */ } };

  // New req form
  const [newAccountId, setNewAccountId] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newInitDate, setNewInitDate] = useState('');
  const [newStage, setNewStage] = useState<USStaffingStage>('New');
  const [newClosureDate, setNewClosureDate] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // New account form
  const [newAcctName, setNewAcctName] = useState('');
  const [newAcctCategory, setNewAcctCategory] = useState<AccountCategory>('MSP');

  const toggleAccount = (id: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Sales-plan integration — load once on mount.
  const salesPlanLoad = useSalesPlanStore((s) => s.load);
  const salesPlanLoaded = useSalesPlanStore((s) => s.loaded);
  const salesPlanLoading = useSalesPlanStore((s) => s.loading);
  const salesPlanByName = useSalesPlanStore((s) => s.byName);
  const salesPlanUpdated = useSalesPlanStore((s) => s.updatedAt);
  useEffect(() => { void salesPlanLoad(); }, [salesPlanLoad]);

  /** Look up the plan insight for a US account by normalized name. */
  const planInsightFor = useCallback((name: string): AccountInsight | undefined => {
    return salesPlanByName[normalizeAccountName(name)];
  }, [salesPlanByName]);

  /* —— Derived data —— */
  const mspAccounts = useMemo(() => accounts.filter(a => a.category === 'MSP'), [accounts]);
  const siAccounts = useMemo(() => accounts.filter(a => a.category === 'SI'), [accounts]);

  const reqsWithAccount = useMemo(() =>
    requisitions.map(r => ({ ...r, account_name: accounts.find(a => a.id === r.account_id)?.name || 'Unknown', account_category: accounts.find(a => a.id === r.account_id)?.category || 'MSP' })),
    [requisitions, accounts]
  );

  const filteredReqs = useMemo(() => {
    let data = reqsWithAccount;
    if (filterStage !== 'All') data = data.filter(r => r.stage === filterStage);
    return data;
  }, [reqsWithAccount, filterStage]);

  // Stats
  const totalReqs = requisitions.length;
  const activeReqs = requisitions.filter(r => !['Closed/Selected', 'Onboarding', 'Cancelled'].includes(r.stage)).length;
  const closedReqs = requisitions.filter(r => r.stage === 'Closed/Selected' || r.stage === 'Onboarding').length;
  const mspReqs = reqsWithAccount.filter(r => r.account_category === 'MSP').length;
  const siReqs = reqsWithAccount.filter(r => r.account_category === 'SI').length;

  // Stage distribution
  const stageDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    ALL_STAGES.forEach(s => counts[s] = 0);
    requisitions.forEach(r => { counts[r.stage] = (counts[r.stage] || 0) + 1; });
    return counts;
  }, [requisitions]);

  const handleAddReq = () => {
    if (!newAccountId || !newRole) return;
    addRequisition({
      account_id: newAccountId,
      role: newRole,
      initiation_date: newInitDate || new Date().toISOString().slice(0, 10),
      stage: newStage,
      closure_date: newClosureDate,
      notes: newNotes,
    });
    setNewAccountId(''); setNewRole(''); setNewInitDate(''); setNewStage('New'); setNewClosureDate(''); setNewNotes('');
    setShowAddReq(false);
  };

  const handleAddAccount = () => {
    if (!newAcctName) return;
    addAccount(newAcctName, newAcctCategory);
    setNewAcctName(''); setNewAcctCategory('MSP');
    setShowAddAccount(false);
  };

  const handleCellSave = useCallback((id: string, field: string, val: string | number) => {
    updateRequisition(id, { [field]: val });
  }, [updateRequisition]);

  /* —— AI Scoring for forecast —— */
  const scoreReq = (req: typeof reqsWithAccount[0]) => {
    const stageScores: Record<string, number> = {
      'New': 15, 'Sourcing': 25, 'Profiles Shared': 35, 'Interview': 50,
      'Shortlisted': 60, 'Client Round': 75, 'Closed/Selected': 90, 'Onboarding': 95,
      'On Hold': 20, 'Cancelled': 5,
    };
    let score = stageScores[req.stage] || 30;
    const notes = (req.notes || '').toLowerCase();
    if (notes.includes('final round') || notes.includes('selected')) score += 10;
    if (notes.includes('shortlisted')) score += 5;
    if (notes.includes('no response') || notes.includes('stalled')) score -= 10;
    if (notes.includes('reject')) score -= 15;
    if (req.closure_date) {
      const daysLeft = Math.ceil((new Date(req.closure_date).getTime() - Date.now()) / 86400000);
      if (daysLeft < 0) score -= 10;
      else if (daysLeft < 7) score += 5;
    }
    return Math.max(5, Math.min(95, score));
  };

  const scoredReqs = useMemo(() =>
    reqsWithAccount.map(r => ({ ...r, closureProb: scoreReq(r), risk: scoreReq(r) >= 65 ? 'low' as const : scoreReq(r) <= 35 ? 'high' as const : 'medium' as const })),
    [reqsWithAccount]
  );

  const forecastFiltered = useMemo(() => {
    let data = scoredReqs;
    if (activeTab === 'forecast') return data;
    return data;
  }, [scoredReqs, activeTab]);

  const fTotalReqs = scoredReqs.length;
  const fOptimistic = scoredReqs.filter(r => r.closureProb >= 40).length;
  const fRealistic = scoredReqs.filter(r => r.closureProb >= 60).length;
  const fConservative = scoredReqs.filter(r => r.closureProb >= 75).length;
  const fAtRisk = scoredReqs.filter(r => r.risk === 'high').length;
  const fAvgProb = scoredReqs.length ? Math.round(scoredReqs.reduce((s, r) => s + r.closureProb, 0) / scoredReqs.length) : 0;

  /* —— Render grouped by account — India-Demand-style bold banners ——
   *
   * One flat table per category (MSP / SI), with each account introduced by
   * a bold gradient banner row showing: building icon, account name, MSP/SI
   * badge, req count, active count, and average AI probability. Within each
   * account the rows are sorted by AI probability descending so the strongest
   * roles surface first. Every existing field is preserved (Role / Initiation
   * / Stage / Closure / Notes) and remains inline-editable. */
  const renderAccountGroup = (acctList: typeof accounts, categoryLabel: string) => {
    const populatedAccounts = acctList.filter(a => filteredReqs.some(r => r.account_id === a.id));
    if (populatedAccounts.length === 0) return null;
    const totalReqs = filteredReqs.filter(r => acctList.some(a => a.id === r.account_id)).length;

    // Build a flat ordered list with stable account-grouping. We sort by
    // account name then by AI prob desc within the group so we can emit a
    // banner whenever the account_id changes from the previous row.
    const ordered = [...filteredReqs]
      .filter(r => acctList.some(a => a.id === r.account_id))
      .map(r => {
        const acct = acctList.find(a => a.id === r.account_id);
        const score = scoreReq({ ...r, account_name: acct?.name || '', account_category: acct?.category || categoryLabel } as any);
        return { ...r, _account_name: acct?.name || 'Unknown', _account_category: acct?.category, _score: score };
      })
      .sort((a, b) =>
        a._account_name.localeCompare(b._account_name) ||
        b._score - a._score,
      );

    return (
      <div className="mb-8">
        {/* Category section header */}
        <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
          <Building2 size={16} /> {categoryLabel}
          <span className="text-xs font-normal text-slate-400">
            ({totalReqs} requisitions across {populatedAccounts.length} accounts)
          </span>
        </h3>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2 text-left font-semibold text-[10px] min-w-[180px]">Account / Role</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px]">Initiation Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px]">Stage</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px]">Closure Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px]">AI Prob</th>
                  <th className="px-3 py-2 text-left font-semibold text-[10px] min-w-[200px]">Notes</th>
                  <th className="px-3 py-2 text-center font-semibold text-[10px] w-12"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let prevAccountId: string | null = null;
                  return ordered.map((req) => {
                    const showBanner = req.account_id !== prevAccountId;
                    if (showBanner) prevAccountId = req.account_id;

                    // Aggregate stats for this account (computed once per banner)
                    let acctReqCount = 0;
                    let activeCount = 0;
                    let avgAi = 0;
                    if (showBanner) {
                      const same = ordered.filter(x => x.account_id === req.account_id);
                      acctReqCount = same.length;
                      activeCount = same.filter(x => !['Closed/Selected', 'Onboarding', 'Cancelled'].includes(x.stage as string)).length;
                      avgAi = same.length
                        ? Math.round(same.reduce((s, x) => s + x._score, 0) / same.length)
                        : 0;
                    }

                    const probColor = req._score >= 65 ? '#10b981' : req._score >= 40 ? '#f59e0b' : '#ef4444';

                    const acctInsight = showBanner ? planInsightFor(req._account_name) : undefined;
                    const acctForecast = acctInsight?.forecast ?? 0;
                    const acctSecured = acctInsight?.secured ?? 0;
                    const acctUnsecured = acctInsight?.unsecured ?? 0;
                    const acctLockedPct = acctInsight?.pctLocked ?? 0;
                    const acctUrgent = acctForecast > 0 && acctUnsecured >= URGENT_UNSECURED && acctLockedPct < URGENT_PCT_LOCKED;

                    return (
                      <React.Fragment key={req.id}>
                        {showBanner && (
                          <tr className={`border-y-2 ${acctUrgent ? 'border-rose-200' : 'border-blue-200'} ${acctUrgent ? 'bg-gradient-to-r from-rose-50 via-rose-50 to-amber-50' : 'bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50'} group/banner`}>
                            <td colSpan={7} className="py-2.5 px-3">
                              <div className="flex items-baseline gap-3 flex-wrap">
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${acctUrgent ? 'bg-rose-600 text-white' : 'bg-primary/15 text-primary'}`}>
                                  {acctUrgent ? <Flame size={14} /> : <Building2 size={14} />}
                                </span>
                                <span className="text-base font-extrabold text-slate-900 tracking-tight">
                                  {req._account_name}
                                </span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  req._account_category === 'MSP'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-violet-100 text-violet-700'
                                }`}>
                                  {req._account_category}
                                </span>
                                {acctUrgent && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-600 text-white inline-flex items-center gap-1">
                                    <Flame size={9} /> Urgent: sales + delivery sync
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                                  {acctReqCount} {acctReqCount === 1 ? 'role' : 'roles'}
                                  <span className="text-slate-300 mx-1">·</span>
                                  <span className="text-emerald-700">{activeCount}</span> active
                                  <span className="text-slate-300 mx-1">·</span>
                                  avg AI prob <span className="text-slate-700">{avgAi}%</span>
                                </span>
                                {acctForecast > 0 && (
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide inline-flex items-center gap-2">
                                    <span className="text-slate-300">·</span>
                                    Forecast <span className="text-slate-800"><Sensitive>{fmtMoney(acctForecast)}</Sensitive></span>
                                    <span className="text-slate-300">·</span>
                                    <Lock size={9} className="text-emerald-600" /> <span className="text-emerald-700"><Sensitive>{fmtMoney(acctSecured)}</Sensitive></span>
                                    <span className="text-slate-300">·</span>
                                    <Unlock size={9} className={acctUrgent ? 'text-rose-600' : 'text-amber-600'} /> <span className={acctUrgent ? 'text-rose-700' : 'text-amber-700'}><Sensitive>{fmtMoney(acctUnsecured)}</Sensitive></span>
                                    <span className="text-slate-300">·</span>
                                    {Math.round(acctLockedPct * 100)}% locked
                                  </span>
                                )}
                                {acctInsight && acctInsight.signalCount > 0 && (
                                  <span className="text-[10px] text-violet-600 font-semibold inline-flex items-center gap-1">
                                    <Activity size={10} /> {acctInsight.signalCount} connect{acctInsight.signalCount === 1 ? '' : 's'}
                                  </span>
                                )}
                                {/* Delete-account hover affordance */}
                                <span className="flex-1" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`Delete account "${req._account_name}" and all its ${acctReqCount} requisitions?`)) {
                                      filteredReqs.filter(r => r.account_id === req.account_id).forEach(r => removeRequisition(r.id));
                                      removeAccount(req.account_id);
                                    }
                                  }}
                                  className="opacity-0 group-hover/banner:opacity-100 transition-opacity p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded text-[10px]"
                                  title="Delete account"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                              {acctForecast > 0 && (
                                <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden flex" title={`${Math.round(acctLockedPct * 100)}% locked`}>
                                  <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(100, Math.round(acctLockedPct * 100))}%` }} />
                                  <div className={`${acctUrgent ? 'bg-rose-400' : 'bg-amber-400'} h-full`} style={{ width: `${100 - Math.min(100, Math.round(acctLockedPct * 100))}%` }} />
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        <tr className="border-t border-slate-100 hover:bg-blue-50/30">
                          {/* Role — indented under the account banner with a ↳ guide */}
                          <td className="px-3 py-2 pl-10">
                            <div className="flex items-center gap-1.5">
                              <span className="text-slate-300 text-[10px]">↳</span>
                              <EditableCell value={req.role} onSave={(v) => handleCellSave(req.id, 'role', v)} />
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <EditableCell value={req.initiation_date} onSave={(v) => handleCellSave(req.id, 'initiation_date', v)} />
                          </td>
                          <td className="px-3 py-2">
                            <EditableCell
                              value={req.stage} type="select" options={ALL_STAGES}
                              onSave={(v) => handleCellSave(req.id, 'stage', v)}
                              displayContent={
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: US_STAGE_COLORS[req.stage as USStaffingStage] || '#94a3b8' }}>
                                  {req.stage}
                                </span>
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <EditableCell value={req.closure_date} onSave={(v) => handleCellSave(req.id, 'closure_date', v)} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-10 h-1.5 rounded bg-slate-100 overflow-hidden">
                                <div className="h-full rounded" style={{ width: `${req._score}%`, background: probColor }} />
                              </div>
                              <span className="font-bold text-[11px] tabular-nums" style={{ color: probColor }}>{req._score}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 max-w-[260px]">
                            <EditableCell value={req.notes} type="textarea" onSave={(v) => handleCellSave(req.id, 'notes', v)} />
                          </td>
                          <td className="px-3 py-2 text-center whitespace-nowrap">
                            <button
                              onClick={() => openJdDrawer(req.id)}
                              disabled={jdReqId === req.id && jdState === 'loading'}
                              className={`p-1 mr-0.5 rounded transition-colors disabled:opacity-50 ${
                                req.job_description?.trim()
                                  ? 'text-amber-600 hover:bg-amber-50'
                                  : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                              }`}
                              title={req.job_description?.trim() ? 'View / edit JD' : 'Generate JD'}
                            >
                              {jdReqId === req.id && jdState === 'loading'
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Sparkles size={13} className={req.job_description?.trim() ? 'fill-amber-200' : ''} />}
                            </button>
                            <button onClick={() => { if (confirm(`Delete "${req.role}"?`)) removeRequisition(req.id); }} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete requisition">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  };

  /* —— Overview Tab —— */
  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Total Requisitions" value={totalReqs} icon={<Users size={20} />} subtitle="All US roles" />
        <StatCard label="Active" value={activeReqs} icon={<TrendingUp size={20} />} subtitle="In pipeline" />
        <StatCard label="Closed/Onboarding" value={closedReqs} icon={<CheckCircle size={20} />} subtitle="Filled roles" />
        <StatCard label="MSP Roles" value={mspReqs} icon={<Building2 size={20} />} subtitle="MSP accounts" />
        <StatCard label="SI Roles" value={siReqs} icon={<Globe size={20} />} subtitle="SI accounts" />
      </div>

      {/* Stage Pipeline */}
      <Card>
        <div className="p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3">Stage Pipeline</h3>
          <div className="flex gap-1 items-end h-32">
            {ALL_STAGES.map(stage => {
              const count = stageDistribution[stage] || 0;
              const maxCount = Math.max(...Object.values(stageDistribution), 1);
              const height = Math.max((count / maxCount) * 100, 4);
              return (
                <div key={stage} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-600">{count}</span>
                  <div className="w-full rounded-t" style={{ height: `${height}%`, background: US_STAGE_COLORS[stage] }} />
                  <span className="text-[9px] text-slate-400 text-center leading-tight">{stage}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Account Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['MSP', 'SI'] as const).map((category) => {
          const acctList = category === 'MSP' ? mspAccounts : siAccounts;
          const Icon = category === 'MSP' ? Building2 : Globe;
          const sorted = [...acctList].sort((a, b) => {
            const aCount = requisitions.filter(r => r.account_id === a.id).length;
            const bCount = requisitions.filter(r => r.account_id === b.id).length;
            // Populated first (desc), then empty alphabetical.
            if ((aCount > 0) !== (bCount > 0)) return bCount - aCount;
            if (aCount !== bCount) return bCount - aCount;
            return a.name.localeCompare(b.name);
          });
          return (
            <Card key={category}>
              <div className="p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <Icon size={16} /> {category} Accounts
                  <span className="text-xs font-normal text-slate-400">({acctList.length})</span>
                </h3>
                {sorted.length === 0 && (
                  <p className="text-xs text-slate-400 italic">No {category} accounts yet</p>
                )}
                {sorted.map(a => {
                  const count = requisitions.filter(r => r.account_id === a.id).length;
                  const isEmpty = count === 0;
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0 group/row ${isEmpty ? 'opacity-60' : ''}`}
                    >
                      <span className="text-xs text-slate-700">{a.name}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${isEmpty ? 'text-slate-400 italic' : 'text-slate-500'}`}>
                          {count} {count === 1 ? 'role' : 'roles'}
                        </span>
                        <button
                          onClick={() => {
                            const msg = isEmpty
                              ? `Delete empty account "${a.name}"?`
                              : `Delete "${a.name}" and all its ${count} requisitions?`;
                            if (confirm(msg)) {
                              if (!isEmpty) {
                                requisitions.filter(r => r.account_id === a.id).forEach(r => removeRequisition(r.id));
                              }
                              removeAccount(a.id);
                            }
                          }}
                          className={`p-0.5 text-red-400 hover:text-red-600 transition-opacity ${
                            isEmpty ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover/row:opacity-100'
                          }`}
                          title={isEmpty ? 'Delete empty account' : 'Delete account'}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );

  /* —— Requisitions Tab (All / MSP / SI) —— */
  const renderRequisitions = () => (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterStage} onChange={e => setFilterStage(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="All">All Stages</option>
          {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setShowAddReq(true)} className="flex items-center gap-1 text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Add Requisition
        </button>
        <button onClick={() => setShowAddAccount(true)} className="flex items-center gap-1 text-xs bg-slate-600 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700">
          <Plus size={14} /> Add Account
        </button>
      </div>

      {/* Add Req Modal */}
      {showAddReq && (
        <Card className="border-2 border-blue-200 bg-blue-50/30">
          <div className="p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-700">New Requisition</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Account</label>
                <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  <option value="">Select account...</option>
                  <optgroup label="MSP">
                    {mspAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                  <optgroup label="SI">
                    {siAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Role</label>
                <input value={newRole} onChange={e => setNewRole(e.target.value)} placeholder="e.g. Salesforce Developer"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Initiation Date</label>
                <input type="date" value={newInitDate} onChange={e => setNewInitDate(e.target.value)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Stage</label>
                <select value={newStage} onChange={e => setNewStage(e.target.value as USStaffingStage)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {ALL_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Closure Date</label>
                <input type="date" value={newClosureDate} onChange={e => setNewClosureDate(e.target.value)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Notes</label>
                <input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Optional notes"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleAddReq} className="text-xs bg-primary text-white px-4 py-1.5 rounded-lg hover:bg-primary/90">Save</button>
              <button onClick={() => setShowAddReq(false)} className="text-xs text-slate-500 px-4 py-1.5 rounded-lg hover:bg-slate-100">Cancel</button>
            </div>
          </div>
        </Card>
      )}

      {/* Add Account Modal */}
      {showAddAccount && (
        <Card className="border-2 border-green-200 bg-green-50/30">
          <div className="p-4 space-y-3">
            <h4 className="text-sm font-bold text-slate-700">New Account</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Account Name</label>
                <input value={newAcctName} onChange={e => setNewAcctName(e.target.value)} placeholder="e.g. TEKsystems"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Category</label>
                <select value={newAcctCategory} onChange={e => setNewAcctCategory(e.target.value as AccountCategory)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleAddAccount} className="text-xs bg-green-600 text-white px-4 py-1.5 rounded-lg hover:bg-green-700">Save</button>
              <button onClick={() => setShowAddAccount(false)} className="text-xs text-slate-500 px-4 py-1.5 rounded-lg hover:bg-slate-100">Cancel</button>
            </div>
          </div>
        </Card>
      )}

      {/* Sales-plan portfolio strip */}
      {(() => {
        const all = [...mspAccounts, ...siAccounts];
        const insights = all.map((a) => ({ a, ins: planInsightFor(a.name) }));
        const matched = insights.filter((x) => x.ins && x.ins.forecast > 0);
        const totalForecast = matched.reduce((s, x) => s + (x.ins?.forecast ?? 0), 0);
        const totalSecured = matched.reduce((s, x) => s + (x.ins?.secured ?? 0), 0);
        const totalUnsecured = Math.max(0, totalForecast - totalSecured);
        const urgent = insights.filter(({ ins }) => ins && ins.forecast > 0 && ins.unsecured >= URGENT_UNSECURED && ins.pctLocked < URGENT_PCT_LOCKED);
        return (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1"><Building2 size={11} /> Accounts</div>
                <div className="text-xl font-extrabold text-slate-800">{all.length}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{matched.length} in sales plan</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1"><DollarSign size={11} /> Forecast 2026</div>
                <div className="text-xl font-extrabold text-slate-800"><Sensitive>{fmtMoney(totalForecast)}</Sensitive></div>
                <div className="text-[10px] text-slate-500 mt-0.5">across {matched.length} accounts</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1 flex items-center gap-1"><Lock size={11} /> Secured</div>
                <div className="text-xl font-extrabold text-emerald-700"><Sensitive>{fmtMoney(totalSecured)}</Sensitive></div>
                <div className="text-[10px] text-emerald-600/80 mt-0.5">{totalForecast > 0 ? `${Math.round((totalSecured / totalForecast) * 100)}% of plan locked` : '—'}</div>
              </div>
              <div className={`rounded-xl border p-3 ${urgent.length > 0 ? 'border-rose-300 bg-rose-50/60' : 'border-amber-200 bg-amber-50/40'}`}>
                <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 flex items-center gap-1 ${urgent.length > 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                  <Unlock size={11} /> Unsecured
                </div>
                <div className={`text-xl font-extrabold ${urgent.length > 0 ? 'text-rose-700' : 'text-amber-700'}`}><Sensitive>{fmtMoney(totalUnsecured)}</Sensitive></div>
                <div className={`text-[10px] mt-0.5 ${urgent.length > 0 ? 'text-rose-600' : 'text-amber-600/80'}`}>
                  {urgent.length > 0 ? `${urgent.length} account${urgent.length === 1 ? '' : 's'} need sales+delivery sync` : 'No urgent accounts'}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-center gap-2">
                <Sparkles size={12} className="text-violet-500" />
                <span>Forecast data from the 2026 Sales Plan{salesPlanUpdated ? ` · updated ${new Date(salesPlanUpdated).toLocaleDateString()}` : ''}</span>
                {salesPlanLoading && <span className="text-slate-400">(refreshing…)</span>}
                {!salesPlanLoaded && !salesPlanLoading && <span className="text-rose-500">(not loaded)</span>}
              </div>
              <button
                type="button"
                onClick={() => void useSalesPlanStore.getState().load({ force: true })}
                className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-primary transition-colors"
              >
                <RefreshCw size={10} /> Refresh
              </button>
            </div>
          </>
        );
      })()}

      {/* Requisitions grouped by MSP / SI */}
      {renderAccountGroup(mspAccounts, 'MSP Accounts')}
      {renderAccountGroup(siAccounts, 'SI Accounts')}
    </div>
  );

  /* —— Page —— */
  return (
    <div className="space-y-6">
      <PageHeader
        title="US Staffing"
        subtitle="Manage US staffing requisitions across MSP and SI accounts"
      />

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[
          { key: 'all', label: 'All Requisitions' },
          { key: 'forecast', label: 'AI Forecast' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === tab.key ? 'bg-white text-primary shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'forecast' ? (
        <>
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 mb-6 text-white">
            <div className="flex items-center gap-2 mb-1">
              <Brain size={18} />
              <h2 className="font-bold text-base">AI-Powered Closure Forecast</h2>
              <span className="bg-gradient-to-r from-violet-500 to-blue-500 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide">AI Insights</span>
            </div>
            <p className="text-slate-400 text-xs mb-5">Based on pipeline stage, notes sentiment, and closure timeline</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Total Roles', val: fTotalReqs, color: '#94a3b8', conf: 100 },
                { label: 'Optimistic', val: fOptimistic, color: '#10b981', conf: 40, desc: 'Prob >= 40%' },
                { label: 'Realistic', val: fRealistic, color: '#3b82f6', conf: 70, desc: 'Prob >= 60%' },
                { label: 'Conservative', val: fConservative, color: '#f59e0b', conf: 90, desc: 'Prob >= 75%' },
                { label: 'At Risk', val: fAtRisk, color: '#ef4444', conf: 85, desc: 'High risk' },
              ].map((s) => (
                <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h4 className="text-blue-300 text-xs font-semibold mb-2">{s.label}</h4>
                  <div className="text-2xl font-extrabold mb-1" style={{ color: s.color }}>{s.val} <span className="text-sm text-slate-400 font-normal">of {fTotalReqs}</span></div>
                  {s.desc && <p className="text-[10px] text-slate-500">{s.desc}</p>}
                  <div className="h-1 bg-white/10 rounded mt-2 overflow-hidden"><div className="h-full rounded" style={{ width: `${s.conf}%`, background: s.color }} /></div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center">
              <span className="text-slate-300 text-sm font-semibold">Average Closure Probability: </span>
              <span className="text-xl font-extrabold" style={{ color: fAvgProb >= 60 ? '#10b981' : fAvgProb >= 40 ? '#f59e0b' : '#ef4444' }}>{fAvgProb}%</span>
            </div>
          </div>

          <Card>
            <h3 className="font-bold text-sm mb-3">Forecast by Requisition</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b-2 border-slate-100">
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Account</th>
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Role</th>
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Stage</th>
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Prob</th>
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Risk</th>
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Closure Date</th>
                    <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {[...scoredReqs].sort((a, b) => b.closureProb - a.closureProb).map(req => {
                    let rec = 'Monitor progress';
                    if (req.risk === 'high') rec = 'Escalate - add more profiles & parallel source';
                    else if (req.stage === 'New' || req.stage === 'Sourcing') rec = 'Accelerate sourcing - increase pipeline';
                    else if (req.stage === 'Client Round') rec = 'Follow up with client for feedback';
                    else if (req.stage === 'Onboarding' || req.stage === 'Closed/Selected') rec = 'Track onboarding timeline';
                    else if (req.stage === 'On Hold') rec = 'Re-engage - check if requirement is still active';
                    const probColor = req.closureProb >= 65 ? '#10b981' : req.closureProb >= 40 ? '#f59e0b' : '#ef4444';
                    return (
                      <tr key={req.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="p-2 font-bold">{req.account_name}</td>
                        <td className="p-2">{req.role}</td>
                        <td className="p-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: US_STAGE_COLORS[req.stage as USStaffingStage] || '#94a3b8' }}>
                            {req.stage}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <div className="w-10 h-1.5 rounded bg-slate-100 overflow-hidden">
                              <div className="h-full rounded" style={{ width: `${req.closureProb}%`, background: probColor }} />
                            </div>
                            <span className="font-bold">{req.closureProb}%</span>
                          </div>
                        </td>
                        <td className="p-2">
                          <StatusBadge status={req.risk === 'high' ? 'at-risk' : req.risk === 'medium' ? 'caution' : 'on-track'} label={req.risk} />
                        </td>
                        <td className="p-2 text-slate-500">{req.closure_date || 'TBD'}</td>
                        <td className="p-2 text-slate-500">{rec}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : renderRequisitions()}

      {/* ── Generate JD drawer ── */}
      {jdReqId && (() => {
        const reqRow = requisitions.find((rq) => rq.id === jdReqId);
        const acctName = reqRow ? (accounts.find((a) => a.id === reqRow.account_id)?.name || '—') : '—';
        return (
          <div
            className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
            onClick={(e) => { if (e.target === e.currentTarget) closeJdDrawer(); }}
          >
            <div className="bg-white w-full max-w-2xl h-full flex flex-col shadow-xl">
              <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Sparkles size={14} className="text-amber-500 flex-shrink-0" />
                    {reqRow?.role || 'Job description'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    US · {acctName}
                    {jdGeneratedAt && (<> · {jdCachedFromDb ? 'cached' : 'generated'} {new Date(jdGeneratedAt).toLocaleString()}</>)}
                  </div>
                </div>
                <button onClick={closeJdDrawer} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
              </div>

              {jdState === 'loading' && (
                <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 flex items-center gap-2">
                  <Loader2 size={12} className="animate-spin" /> Asking Claude to draft the JD…
                </div>
              )}
              {jdState === 'error' && (
                <div className="px-5 py-3 bg-red-50 border-b border-red-200 text-[11px] text-red-700">{jdError}</div>
              )}
              {jdState === 'ready' && jdDirty && (
                <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900">
                  Unsaved edits — click <strong>Save</strong>.
                </div>
              )}

              <div className="flex-1 overflow-auto p-5">
                <textarea
                  value={jdText}
                  onChange={(e) => { setJdText(e.target.value); setJdDirty(true); }}
                  disabled={jdState === 'loading'}
                  className="w-full h-full min-h-[400px] text-xs font-mono leading-relaxed border border-slate-200 rounded-md p-3 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-slate-50 disabled:text-slate-400"
                  placeholder="Generated JD will appear here…"
                />
              </div>

              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500">Edit freely — your changes save to the requisition.</div>
                <div className="flex items-center gap-2">
                  <button onClick={copyJd} disabled={!jdText || jdState === 'loading'}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 disabled:opacity-40">Copy</button>
                  <button onClick={() => openJdDrawer(jdReqId, { regenerate: true })} disabled={jdState === 'loading'}
                          className="text-xs font-semibold bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-md hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-1"
                          title="Throw away current JD and ask Claude for a fresh draft">
                    <RefreshCw size={12} /> Regenerate
                  </button>
                  <button onClick={saveJd} disabled={!jdDirty || jdState === 'saving' || jdState === 'loading'}
                          className="text-xs font-semibold bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
                    <Save size={12} /> {jdState === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
