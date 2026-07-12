// @ts-nocheck
import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react';
import {
  Users, AlertTriangle, TrendingUp, CheckCircle, Upload,
  Download, Brain, BarChart3, Building2, Pencil, Trash2, Save, X, ChevronDown, ChevronRight, Plus, Archive, History,
  Columns, RefreshCw, Sparkles, Loader2, Clock, Send,
  DollarSign, Lock, Unlock, Flame, Activity, MessageCircle, Briefcase,
} from 'lucide-react';
import { useStaffingStore } from '../store/useStaffingStore';
import { useSalesPlanStore, type AccountInsight } from '../store/useSalesPlanStore';
import { Sensitive } from '../components/Sensitive';
import { analyzeStaffingStatus } from '../lib/staffingAnalysis';
import { computeStageTiming } from '../lib/staffingAlerts';
import { computeFunnel } from '../lib/staffingFunnel';
import { runStaffingBriefing, type StaffingBriefing } from '../lib/claudeQuery';
import { db } from '../lib/supabaseSync';
import { StaffingKanban } from '../components/staffing/StaffingKanban';
import { StageFunnel } from '../components/staffing/StageFunnel';
import { StaffingSmartQuery } from '../components/staffing/StaffingSmartQuery';
import { CandidatePipeline } from '../components/staffing/CandidatePipeline';
import { SendToVendorDialog } from '../components/staffing/SendToVendorDialog';
import { DailyStatusMode } from '../components/staffing/DailyStatusMode';
import { QuickAddSpeedDial } from '../components/staffing/QuickAddSpeedDial';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, StatusBadge } from '../components/ui';
import type { StaffingRow, RiskLevel, PipelineStage, StaffingStatus } from '../types/staffing';
import { STAGE_COLORS, ARCHIVED_STATUSES, CLOSED_WON_STATUSES, LOST_OR_CANCELLED_STATUSES } from '../types/staffing';
import confetti from 'canvas-confetti';

/* -- Constants -- */
const STATUS_OPTIONS: StaffingStatus[] = ['Open', 'In Progress', 'On Hold', 'Closed Won', 'Closed Lost', 'Cancelled'];
const STATUS_COLORS: Record<StaffingStatus, string> = {
  'Open': '#3b82f6',
  'In Progress': '#f59e0b',
  'On Hold': '#94a3b8',
  'Closed Won': '#10b981',
  'Closed Lost': '#b91c1c',
  'Cancelled': '#ef4444',
};
const probColor = (p: number) => p >= 65 ? '#10b981' : p >= 40 ? '#f59e0b' : '#ef4444';
const PIPELINE_STAGES: PipelineStage[] = ['Sourcing','Profiles Shared','Interview','Shortlisted','Client Round','Closed/Selected','Onboarding'];
const ALL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const isArchived = (s: StaffingStatus) => ARCHIVED_STATUSES.includes(s);
const isClosedWon = (s: StaffingStatus) => CLOSED_WON_STATUSES.includes(s);
const isLostOrCancelled = (s: StaffingStatus) => LOST_OR_CANCELLED_STATUSES.includes(s);

/** Fires a short confetti burst — used when a requisition is marked Closed Won. */
function celebrateWin(): void {
  const duration = 1200;
  const end = Date.now() + duration;
  const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#f97316'];
  const tick = () => {
    confetti({ particleCount: 5, startVelocity: 45, spread: 60, angle: 60, origin: { x: 0, y: 0.9 }, colors });
    confetti({ particleCount: 5, startVelocity: 45, spread: 60, angle: 120, origin: { x: 1, y: 0.9 }, colors });
    if (Date.now() < end) requestAnimationFrame(tick);
  };
  tick();
}

/** Days between today (UTC midnight) and an ISO date string. Returns 0 if missing/invalid. */
function calcAgeing(startDate: string): number {
  if (!startDate) return 0;
  const start = Date.parse(startDate);
  if (Number.isNaN(start)) return 0;
  const today = Date.parse(new Date().toISOString().slice(0, 10));
  return Math.max(0, Math.round((today - start) / 86400000));
}

/* -- Editable Cell -- */
function EditableCell({ value, onSave, type = 'text', options, className = '', displayContent }: {
  value: string | number;
  onSave: (val: string | number) => void;
  type?: 'text' | 'number' | 'select';
  options?: string[];
  className?: string;
  displayContent?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<any>(null);

  const focus = () => setTimeout(() => inputRef.current?.focus(), 0);
  const commit = () => {
    const final = type === 'number' ? Number(draft) : draft;
    if (final !== value) onSave(final);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  };

  // All cells (display + editing) target a 28px row height so badges, dates,
  // chips, and inputs sit on the same baseline.
  if (!editing) {
    return (
      <div
        className={`group cursor-pointer rounded px-1 -mx-1 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all h-7 flex items-center ${className}`}
        onClick={() => { setDraft(value); setEditing(true); focus(); }}
        title="Click to edit"
      >
        {displayContent || <span className="text-xs truncate">{value}</span>}
        <Pencil size={10} className="ml-1 opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </div>
    );
  }

  if (type === 'select' && options) {
    return (
      <select ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
        className="w-full h-7 px-2 text-xs leading-tight border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input ref={inputRef} type={type} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
      className={`h-7 px-2 text-xs leading-tight border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 ${type === 'number' ? 'w-16 text-center' : 'w-full'}`}
      min={type === 'number' ? 0 : undefined}
    />
  );
}


export default function IndiaStaffingPage() {
  const { accounts, requisitions, statuses, history, candidates, addRequisition, addStatus, addAccount, updateRequisition, removeRequisition, removeStatus, importRows, historyFor, addCandidate, updateCandidate, removeCandidate, candidatesFor } = useStaffingStore();

  const [monthFilter, setMonthFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'overview' | 'board' | 'accounts' | 'forecast'>('overview');
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showArchive, setShowArchive] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [newReq, setNewReq] = useState({ accountId: '', newAccountName: '', title: '', month: 'April', positions: 1, expectedClosure: '', anticipation: '', clientSpoc: '', department: '', startDate: todayStr, closeByDate: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  // Bulk selection state — keyed by requisition id. Only applies to the active
  // (non-archived) rows; clicking the header checkbox toggles "all visible".
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [groupByAccount, setGroupByAccount] = useState(true);

  // AI Daily Briefing (cached per day in localStorage — see runStaffingBriefing)
  const [briefing, setBriefing] = useState<StaffingBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  // Default collapsed — eats 120px of above-the-fold; click the pill to expand.
  const [briefingExpanded, setBriefingExpanded] = useState(false);

  // Funnel chart collapsible — heavy chart, default collapsed to free 250px.
  const [funnelExpanded, setFunnelExpanded] = useState(false);

  // Daily Status mode — focused overlay for bulk-logging today's statuses.
  const [dailyStatusOpen, setDailyStatusOpen] = useState(false);

  // ── Send-to-vendor state ──
  const [sendVendorReqId, setSendVendorReqId] = useState<string | null>(null);

  // ── JD generator state ──
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
      const res = await db.generateJobDescription(reqId, !!opts.regenerate);
      if (res.ok) {
        setJdText(res.jobDescription);
        setJdGeneratedAt(res.generatedAt);
        setJdCachedFromDb(res.cached);
        setJdState('ready');
      } else {
        setJdError(res.error);
        setJdState('error');
      }
    } catch (e) {
      setJdError((e as Error).message);
      setJdState('error');
    }
  }, []);

  const closeJdDrawer = () => {
    setJdReqId(null); setJdText(''); setJdState('idle'); setJdError(null); setJdDirty(false);
  };

  const saveJd = async () => {
    if (!jdReqId) return;
    setJdState('saving');
    try {
      const r = await db.saveJobDescription(jdReqId, jdText);
      if (!r.ok) { setJdError(r.error || 'Save failed'); setJdState('error'); return; }
      setJdGeneratedAt(new Date().toISOString());
      setJdCachedFromDb(true);
      setJdDirty(false);
      setJdState('ready');
    } catch (e) {
      setJdError((e as Error).message);
      setJdState('error');
    }
  };

  const copyJd = async () => {
    try { await navigator.clipboard.writeText(jdText); } catch { /* ignore */ }
  };

  const accountNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);

  // Sales-plan integration — load once on mount, retry from button if needed.
  const salesPlanLoad = useSalesPlanStore((s) => s.load);
  const salesPlanLoaded = useSalesPlanStore((s) => s.loaded);
  const salesPlanLoading = useSalesPlanStore((s) => s.loading);
  const salesPlanByName = useSalesPlanStore((s) => s.byName);
  const salesPlanUpdated = useSalesPlanStore((s) => s.updatedAt);
  useEffect(() => { void salesPlanLoad(); }, [salesPlanLoad]);

  // Drill-down panel sub-tab (Requisitions / Forecast / Connects)
  const [accountDetailTab, setAccountDetailTab] = useState<'reqs' | 'forecast' | 'connects'>('reqs');

  // Fetch the briefing once on mount (it self-caches for the calendar day so
  // subsequent page loads are free). Depends only on data identity so it
  // re-runs if the underlying data meaningfully changes.
  useEffect(() => {
    let cancelled = false;
    async function load(force = false) {
      setBriefingLoading(true);
      try {
        const b = await runStaffingBriefing({ accounts, requisitions, statuses, history }, { forceRefresh: force });
        if (!cancelled) setBriefing(b);
      } finally {
        if (!cancelled) setBriefingLoading(false);
      }
    }
    load(false);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, requisitions.length, statuses.length, history.length]);

  const regenerateBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const b = await runStaffingBriefing({ accounts, requisitions, statuses, history }, { forceRefresh: true });
      setBriefing(b);
    } finally {
      setBriefingLoading(false);
    }
  }, [accounts, requisitions, statuses, history]);

  /* -- Build enriched rows -- */
  const rows: StaffingRow[] = useMemo(() => {
    // Candidate stages that mean "this position is locked in".
    // Keep this list narrow — only count people who've actually committed to
    // joining. "Offer Extended" doesn't count (yet to be accepted).
    const FILLED_STAGES = new Set<string>(['Offer Accepted', 'Joined']);
    return requisitions.map((req) => {
      const acct = accounts.find((a) => a.id === req.account_id);
      const reqStatuses = statuses
        .filter((s) => s.requisition_id === req.id)
        .sort((a, b) => b.status_date.localeCompare(a.status_date));
      const combinedStatus = reqStatuses.map((s) => `${s.status_date.slice(5).replace('-', '/')}: ${s.status_text}`).join('\n');
      const latestAnticipation = reqStatuses[0]?.anticipation || req.anticipation;
      const analysis = analyzeStaffingStatus(combinedStatus, latestAnticipation);
      const aiProbability = analysis.score; // always-fresh AI score
      const manualProb = typeof req.probability === 'number' ? req.probability : 0;
      const closureProb = manualProb > 0 ? manualProb : aiProbability;
      // How many of this req's positions are already filled? Each locked-in
      // candidate counts for one position. If somehow filled exceeds total
      // requested, clamp to total (data hygiene).
      const filledPositions = Math.min(
        req.new_positions || 0,
        candidates.filter((c) => c.requisition_id === req.id && FILLED_STAGES.has(c.stage)).length,
      );
      const openPositions = Math.max(0, (req.new_positions || 0) - filledPositions);
      return {
        id: req.id, month: req.month, account: acct?.name || 'Unknown', account_id: req.account_id,
        requisition: req.title,
        newPositions: req.new_positions,
        filledPositions,
        openPositions,
        expectedClosure: req.expected_closure,
        startDate: req.start_date || '',
        closeByDate: req.close_by_date || '',
        ageing: calcAgeing(req.start_date || ''),
        statusField: req.status_field || 'Open',
        status: combinedStatus, anticipation: latestAnticipation,
        probability: manualProb,
        aiProbability,
        closureProb,
        risk: analysis.risk,
        stage: req.stage || analysis.stage,
        velocity: analysis.velocity,
        clientSpoc: req.client_spoc || '',
        department: req.department || '',
      };
    });
  }, [requisitions, statuses, accounts, candidates]);

  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].sort(), [rows]);

  /** Active (non-archived) rows after filters */
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (isArchived(r.statusField)) return false;
      if (monthFilter !== 'all' && r.month !== monthFilter) return false;
      if (accountFilter !== 'all' && r.account !== accountFilter) return false;
      if (riskFilter !== 'all' && r.risk !== riskFilter) return false;
      return true;
    });
  }, [rows, monthFilter, accountFilter, riskFilter]);

  /** Archived rows (Closed / Lost / Cancelled) — also respects filters */
  const archivedRows = useMemo(() => {
    return rows.filter((r) => {
      if (!isArchived(r.statusField)) return false;
      if (monthFilter !== 'all' && r.month !== monthFilter) return false;
      if (accountFilter !== 'all' && r.account !== accountFilter) return false;
      return true;
    });
  }, [rows, monthFilter, accountFilter]);

  /* -- KPI aggregates (active only) --
   *  totalPos = total positions still OPEN across active reqs (filled ones
   *  are subtracted). This is the "demand to fill" number. Use newPositions
   *  for "originally requested" rollups only when explicitly needed. */
  const totalPos = filtered.reduce((s, r) => s + r.openPositions, 0);
  const totalRequested = filtered.reduce((s, r) => s + r.newPositions, 0);
  const totalFilled = filtered.reduce((s, r) => s + r.filledPositions, 0);
  const closedRows = filtered.filter((r) => r.stage === 'Closed/Selected' || r.stage === 'Onboarding');
  const closedCount = closedRows.reduce((s, r) => s + r.newPositions, 0);
  const highRiskCount = filtered.filter((r) => r.risk === 'high').length;
  const avgProb = filtered.length ? Math.round(filtered.reduce((s, r) => s + r.closureProb, 0) / filtered.length) : 0;

  /* -- Forecast aggregates — count OPEN positions only.
   *  A fully-filled req shouldn't keep contributing to "still to deliver".
   *  Open=0 reqs get filtered out of every forecast bucket. */
  const stillToFill = filtered.filter((r) => r.openPositions > 0);
  const optimistic   = stillToFill.filter((r) => r.closureProb >= 40).reduce((s, r) => s + r.openPositions, 0);
  const realistic    = stillToFill.filter((r) => r.closureProb >= 60).reduce((s, r) => s + r.openPositions, 0);
  const conservative = stillToFill.filter((r) => r.closureProb >= 75).reduce((s, r) => s + r.openPositions, 0);

  /* -- Cell save handler -- */
  const handleCellSave = useCallback((reqId: string, field: string, value: string | number) => {
    const patch: Record<string, any> = {};
    switch (field) {
      case 'title': patch.title = value; break;
      case 'month': patch.month = value; break;
      case 'new_positions': patch.new_positions = Number(value); break;
      case 'client_spoc': patch.client_spoc = value; break;
      case 'department': patch.department = value; break;
      case 'expected_closure': patch.expected_closure = value; break;
      case 'start_date': patch.start_date = value; break;
      case 'close_by_date': patch.close_by_date = value; break;
      case 'status_field': patch.status_field = value; break;
      case 'stage': patch.stage = value; break;
      case 'anticipation': patch.anticipation = value; break;
      case 'account_id': patch.account_id = value; break;
      case 'probability': {
        const num = Math.max(0, Math.min(100, Number(value) || 0));
        patch.probability = num;
        break;
      }
      default: return;
    }
    // Fire the confetti when a requisition transitions INTO Closed Won.
    // Guarded on the previous value so re-saving an already-won req doesn't
    // re-trigger the celebration.
    if (field === 'status_field' && value === 'Closed Won') {
      const prev = rows.find((r) => r.id === reqId)?.statusField;
      if (prev !== 'Closed Won') celebrateWin();
    }
    updateRequisition(reqId, patch);
  }, [updateRequisition, rows]);

  /* -- Inline status add (Enter to submit) -- */
  const handleInlineStatus = useCallback((reqId: string, text: string) => {
    if (!text.trim()) return;
    addStatus({
      requisition_id: reqId,
      status_date: new Date().toISOString().slice(0, 10),
      status_text: text.trim(),
      anticipation: '',
    });
  }, [addStatus]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* -- CSV import -- */
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').filter(Boolean);
      if (lines.length < 2) return;
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const importedRows = lines.slice(1).map((line) => {
        const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => (row[h] = vals[i] || ''));
        return {
          month: row['month'] || '', account: row['account'] || '', requisition: row['requisition'] || '',
          new_positions: parseInt(row['positions'] || row['new positions']) || 0,
          expected_closure: row['expected closure'] || '', status_text: row['status'] || '',
          anticipation: row['anticipation'] || '',
        };
      });
      const result = importRows(importedRows);
      alert(`Imported ${result.imported} rows. ${result.errors.length ? result.errors.join('\n') : ''}`);
    };
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  /* -- CSV export -- */
  const handleExport = () => {
    let csv = 'Month,Account,Requisition,Positions,Client SPOC,Department,Start Date,Close Date,Ageing (days),Stage,Status,Risk,Prob,AI Prob,Anticipation,Latest Status\n';
    const allExport = [...filtered, ...archivedRows];
    allExport.forEach((r) => {
      csv += `${r.month},"${r.account}","${r.requisition}",${r.newPositions},"${r.clientSpoc}","${r.department}","${r.startDate}","${r.closeByDate}",${r.ageing},${r.stage},${r.statusField},${r.risk},${r.probability}%,${r.aiProbability}%,"${r.anticipation}","${(r.status || '').split('\n')[0]}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `staffing_export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const handleAddRequisition = () => {
    let accountId = newReq.accountId;
    if (accountId === '__new__' && newReq.newAccountName.trim()) {
      const acct = addAccount(newReq.newAccountName.trim());
      accountId = acct.id;
    }
    if (!accountId || accountId === '__new__' || !newReq.title.trim()) return;

    addRequisition({
      account_id: accountId,
      title: newReq.title.trim(),
      month: newReq.month,
      new_positions: newReq.positions,
      expected_closure: newReq.expectedClosure,
      start_date: newReq.startDate || todayStr,
      close_by_date: newReq.closeByDate,
      status_field: 'Open',
      stage: 'Sourcing',
      anticipation: newReq.anticipation,
      client_spoc: newReq.clientSpoc,
      department: newReq.department,
      probability: 0,
      ai_probability: 0,
    });
    setNewReq({ accountId: '', newAccountName: '', title: '', month: newReq.month, positions: 1, expectedClosure: '', anticipation: '', clientSpoc: '', department: '', startDate: todayStr, closeByDate: '' });
    setShowAddForm(false);
  };

  const tabs = [
    { key: 'overview' as const, label: 'Executive Overview', icon: BarChart3 },
    { key: 'board' as const, label: 'Board', icon: Columns },
    { key: 'accounts' as const, label: 'Account Deep Dive', icon: Building2 },
    { key: 'forecast' as const, label: 'AI Forecast', icon: Brain },
  ];

  const accountGroups = useMemo(() => {
    const map = new Map<string, StaffingRow[]>();
    filtered.forEach((r) => {
      const arr = map.get(r.account) || [];
      arr.push(r);
      map.set(r.account, arr);
    });
    return map;
  }, [filtered]);

  /** Table row renderer — shared between active and archive tables */
  const renderRow = (r: StaffingRow, opts: { archived?: boolean; selectable?: boolean; hideAccount?: boolean } = {}) => {
    const isExpanded = expandedRows.has(r.id);
    const reqStatuses = statuses.filter(s => s.requisition_id === r.id).sort((a, b) => b.status_date.localeCompare(a.status_date));
    const rowHistory = historyFor(r.id);
    const req = requisitions.find((x) => x.id === r.id);
    const timing = req ? computeStageTiming(req, history) : { daysInStage: 0, stuckThreshold: 14, isStuck: false };
    const isChecked = selectedIds.has(r.id);
    const fieldLabel = (f: string) => ({
      title: 'Requisition', account_id: 'Account', month: 'Month', new_positions: 'Positions',
      expected_closure: 'Expected Closure', start_date: 'Start Date', close_by_date: 'Close Date',
      status_field: 'Status', stage: 'TA Stage', anticipation: 'Anticipation',
      client_spoc: 'Client SPOC', department: 'Department',
      probability: 'Prob (manual)', ai_probability: 'AI Prob',
    } as Record<string, string>)[f] || f;

    return (
      <React.Fragment key={r.id}>
        <tr className={`border-b border-slate-50 hover:bg-slate-50/50 [&>td]:align-middle ${opts.archived ? 'opacity-75' : ''} ${isChecked ? 'bg-blue-50/40' : ''}`}>
          {opts.selectable && (
            <td className="p-2 text-center">
              <input
                type="checkbox"
                checked={isChecked}
                onChange={(e) => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(r.id);
                    else next.delete(r.id);
                    return next;
                  });
                }}
                className="cursor-pointer"
              />
            </td>
          )}
          {/* Expand */}
          <td className="p-2 text-center">
            <button onClick={() => toggleRow(r.id)} className="p-0.5 rounded hover:bg-slate-100" title="Show status & audit history">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          </td>
          {/* Account — dimmed when the section header already shows it */}
          <td className="p-2">
            <EditableCell value={r.account_id} type="select" options={accounts.map(a => a.id)}
              onSave={(val) => handleCellSave(r.id, 'account_id', val)}
              displayContent={
                <span className={opts.hideAccount ? 'text-slate-300 text-[10px]' : 'font-bold'}>
                  {opts.hideAccount ? '↳' : r.account}
                </span>
              } />
          </td>
          {/* Requisition */}
          <td className="p-2">
            <EditableCell value={r.requisition} onSave={(val) => handleCellSave(r.id, 'title', val)} />
          </td>
          {/* Month */}
          <td className="p-2">
            <EditableCell value={r.month} type="select" options={ALL_MONTHS} onSave={(val) => handleCellSave(r.id, 'month', val)} />
          </td>
          {/* Positions — show "open / total" with filled count badge */}
          <td className="p-2 text-center">
            <div className="inline-flex items-center gap-1.5">
              <EditableCell
                value={r.newPositions}
                type="number"
                onSave={(val) => handleCellSave(r.id, 'new_positions', val)}
                className="justify-center"
                displayContent={
                  <span
                    className="font-bold tabular-nums"
                    title={`${r.openPositions} open · ${r.filledPositions} filled · ${r.newPositions} total`}
                  >
                    {r.filledPositions > 0 ? (
                      <>
                        <span className={r.openPositions === 0 ? 'text-emerald-600' : 'text-slate-900'}>{r.openPositions}</span>
                        <span className="text-slate-400 mx-0.5">/</span>
                        <span className="text-slate-500">{r.newPositions}</span>
                      </>
                    ) : (
                      <span>{r.newPositions}</span>
                    )}
                  </span>
                }
              />
              {r.filledPositions > 0 && (
                <span
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 whitespace-nowrap"
                  title={`${r.filledPositions} candidate${r.filledPositions === 1 ? '' : 's'} filled (Offer Accepted / Joined)`}
                >
                  −{r.filledPositions}
                </span>
              )}
            </div>
          </td>
          {/* Client SPOC */}
          <td className="p-2">
            <EditableCell value={r.clientSpoc} onSave={(val) => handleCellSave(r.id, 'client_spoc', val)} />
          </td>
          {/* Department */}
          <td className="p-2">
            <EditableCell value={r.department} onSave={(val) => handleCellSave(r.id, 'department', val)} />
          </td>
          {/* Start Date */}
          <td className="p-2">
            <input type="date" value={r.startDate}
              className="px-2 py-1 text-[11px] leading-tight border border-slate-200 rounded bg-white hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 w-[120px] align-middle"
              onChange={(e) => handleCellSave(r.id, 'start_date', e.target.value)} />
          </td>
          {/* Close Date */}
          <td className="p-2">
            <input type="date" value={r.closeByDate}
              className="px-2 py-1 text-[11px] leading-tight border border-slate-200 rounded bg-white hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 w-[120px] align-middle"
              onChange={(e) => handleCellSave(r.id, 'close_by_date', e.target.value)} />
            {r.expectedClosure && <div className="text-[9px] text-slate-400 italic mt-0.5">{r.expectedClosure}</div>}
          </td>
          {/* Ageing */}
          <td className="p-2 text-center">
            <span
              className="inline-flex items-center justify-center h-6 font-bold text-[11px] px-2 rounded"
              style={{
                color: r.ageing >= 30 ? '#b91c1c' : r.ageing >= 14 ? '#b45309' : '#334155',
                background: r.ageing >= 30 ? '#fee2e2' : r.ageing >= 14 ? '#fef3c7' : '#f1f5f9',
              }}
              title={r.startDate ? `${r.ageing} days since ${r.startDate}` : 'Set a start date'}
            >
              {r.startDate ? `${r.ageing}d` : '—'}
            </span>
          </td>
          {/* Status */}
          <td className="p-2">
            <EditableCell value={r.statusField} type="select" options={STATUS_OPTIONS}
              onSave={(val) => handleCellSave(r.id, 'status_field', val)}
              displayContent={<span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: STATUS_COLORS[r.statusField] || '#94a3b8' }}>{r.statusField}</span>} />
          </td>
          {/* Stage */}
          <td className="p-2">
            <div className="flex items-center gap-1">
              <EditableCell value={r.stage} type="select" options={PIPELINE_STAGES}
                onSave={(val) => handleCellSave(r.id, 'stage', val)}
                displayContent={<span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: STAGE_COLORS[r.stage] }}>{r.stage}</span>} />
              {!opts.archived && timing.isStuck && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 whitespace-nowrap"
                  title={`In ${r.stage} for ${timing.daysInStage} days — threshold ${timing.stuckThreshold}. Needs attention.`}
                >
                  <Clock size={9} /> {timing.daysInStage}d
                </span>
              )}
            </div>
          </td>
          {/* Risk */}
          <td className="p-2">
            <StatusBadge status={r.risk === 'high' ? 'at-risk' : r.risk === 'medium' ? 'caution' : 'on-track'} label={r.risk} />
          </td>
          {/* Prob (manual) */}
          <td className="p-2">
            <EditableCell
              value={r.probability}
              type="number"
              onSave={(val) => handleCellSave(r.id, 'probability', val)}
              displayContent={
                <span className="font-bold text-[11px]" style={{ color: r.probability > 0 ? probColor(r.probability) : '#94a3b8' }}>
                  {r.probability > 0 ? `${r.probability}%` : '—'}
                </span>
              }
            />
          </td>
          {/* AI Prob */}
          <td className="p-2">
            <div className="flex items-center gap-1.5" title="AI-calculated from status history (read-only)">
              <div className="w-10 h-1.5 rounded bg-slate-100 overflow-hidden">
                <div className="h-full rounded" style={{ width: `${r.aiProbability}%`, background: probColor(r.aiProbability) }} />
              </div>
              <span className="font-bold text-[11px]">{r.aiProbability}%</span>
            </div>
          </td>
          {/* Inline status add */}
          <td className="p-2">
            <input
              placeholder="Quick status update..."
              className="w-full h-7 px-2 text-[11px] leading-tight border border-slate-200 rounded bg-white hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const input = e.target as HTMLInputElement;
                  handleInlineStatus(r.id, input.value);
                  input.value = '';
                }
              }}
            />
            {reqStatuses[0] && (
              <div className="text-[9px] text-slate-400 mt-1 truncate max-w-[170px]" title={reqStatuses[0].status_text}>
                {reqStatuses[0].status_date.slice(5)}: {reqStatuses[0].status_text}
              </div>
            )}
            {!opts.archived && (() => {
              // Stale = latest status > 7 days old (or no status ever, but req exists)
              const latestDate = reqStatuses[0]?.status_date;
              if (!latestDate) return null;
              const days = Math.floor((Date.now() - new Date(latestDate).getTime()) / 86_400_000);
              if (days < 7) return null;
              return (
                <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-full bg-amber-50 text-amber-700 border border-amber-200" title={`No status update in ${days} days`}>
                  <Clock size={9} /> Stale · {days}d
                </span>
              );
            })()}
          </td>
          {/* Actions: Generate JD + Send to Vendor + Delete */}
          <td className="p-2 whitespace-nowrap text-right">
            <button
              onClick={() => openJdDrawer(r.id)}
              disabled={jdReqId === r.id && jdState === 'loading'}
              className={`p-1 rounded mr-0.5 align-middle transition-colors disabled:opacity-50 ${
                r.job_description?.trim()
                  ? 'text-amber-600 hover:bg-amber-50'
                  : 'text-slate-300 hover:bg-amber-50 hover:text-amber-600'
              }`}
              title={r.job_description?.trim() ? 'View / edit JD' : 'Generate JD'}
            >
              {jdReqId === r.id && jdState === 'loading'
                ? <Loader2 size={12} className="animate-spin" />
                : <Sparkles size={12} className={r.job_description?.trim() ? 'fill-amber-200' : ''} />}
            </button>
            <button
              onClick={() => setSendVendorReqId(r.id)}
              className="p-1 rounded mr-0.5 align-middle transition-colors text-slate-300 hover:bg-primary/10 hover:text-primary"
              title="Send to vendor — request candidates"
            >
              <Send size={12} />
            </button>
            <button onClick={() => { if (confirm(`Delete "${r.requisition}"?`)) removeRequisition(r.id); }}
              className="p-1 rounded align-middle hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors" title="Delete requisition">
              <Trash2 size={12} />
            </button>
          </td>
        </tr>

        {/* Expanded status + audit history */}
        {isExpanded && (
          <tr key={`${r.id}-exp`}>
            <td colSpan={opts.selectable ? 18 : 17} className="bg-slate-50/80 p-0">
              <div className="px-8 py-3 space-y-4">
                {/* Status updates */}
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Status History</div>
                  {reqStatuses.length === 0 && <p className="text-xs text-slate-400 italic">No status updates yet</p>}
                  <div className="space-y-1.5">
                    {reqStatuses.map(s => (
                      <div key={s.id} className="flex items-start gap-3 text-xs group">
                        <span className="text-slate-400 font-mono text-[10px] w-20 flex-shrink-0 pt-0.5">{s.status_date}</span>
                        <span className="flex-1 text-slate-600">{s.status_text}</span>
                        {s.anticipation && <span className="text-blue-500 text-[10px] italic flex-shrink-0">{'→'} {s.anticipation}</span>}
                        <button onClick={() => { if (confirm('Delete this status?')) removeStatus(s.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-all flex-shrink-0" title="Delete status">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {/* Detailed add */}
                  <div className="mt-3 flex gap-2 items-end">
                    <input type="date" className="px-2 py-1 text-[11px] border border-slate-200 rounded bg-white" defaultValue={new Date().toISOString().slice(0,10)} id={`date-${r.id}`} />
                    <input placeholder="Status update..." className="flex-1 px-2 py-1 text-[11px] border border-slate-200 rounded bg-white" id={`text-${r.id}`} />
                    <input placeholder="Anticipation..." className="w-40 px-2 py-1 text-[11px] border border-slate-200 rounded bg-white" id={`antic-${r.id}`} />
                    <button onClick={() => {
                      const dateEl = document.getElementById(`date-${r.id}`) as HTMLInputElement;
                      const textEl = document.getElementById(`text-${r.id}`) as HTMLInputElement;
                      const anticEl = document.getElementById(`antic-${r.id}`) as HTMLInputElement;
                      if (textEl.value) {
                        addStatus({ requisition_id: r.id, status_date: dateEl.value, status_text: textEl.value, anticipation: anticEl.value });
                        textEl.value = ''; anticEl.value = '';
                      }
                    }} className="px-3 py-1 bg-primary text-white rounded text-[11px] font-semibold hover:bg-primary/90 flex-shrink-0">
                      + Add
                    </button>
                  </div>
                </div>

                {/* Candidate pipeline for this req */}
                <div className="border-t border-slate-200 pt-3">
                  <CandidatePipeline
                    requisitionId={r.id}
                    candidates={candidatesFor(r.id)}
                    onAdd={addCandidate}
                    onUpdate={updateCandidate}
                    onRemove={removeCandidate}
                  />
                </div>

                {/* Audit log */}
                <div className="border-t border-slate-200 pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <History size={11} className="text-slate-400" />
                    <div className="text-[10px] font-bold text-slate-400 uppercase">Field Audit Log ({rowHistory.length})</div>
                  </div>
                  {rowHistory.length === 0 && <p className="text-xs text-slate-400 italic">No field changes recorded yet</p>}
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {rowHistory.map(h => (
                      <div key={h.id} className="flex items-start gap-3 text-[11px] font-mono">
                        <span className="text-slate-400 w-36 flex-shrink-0">{new Date(h.changed_at).toLocaleString()}</span>
                        <span className="text-slate-700 font-semibold w-28 flex-shrink-0">{fieldLabel(h.field)}</span>
                        <span className="text-rose-500 line-through flex-shrink-0 max-w-[160px] truncate" title={h.old_value}>{h.old_value || '∅'}</span>
                        <span className="text-slate-400">→</span>
                        <span className="text-emerald-600 flex-1 truncate" title={h.new_value}>{h.new_value || '∅'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const TableHeader = ({ selectable = false }: { selectable?: boolean } = {}) => (
    <thead>
      <tr className="border-b-2 border-slate-100">
        {selectable && (
          <th className="w-6 p-2 text-center">
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id))}
              ref={(el) => {
                if (el) {
                  const some = filtered.some((r) => selectedIds.has(r.id));
                  const all = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));
                  el.indeterminate = some && !all;
                }
              }}
              onChange={(e) => {
                if (e.target.checked) setSelectedIds(new Set(filtered.map((r) => r.id)));
                else setSelectedIds(new Set());
              }}
              className="cursor-pointer"
              title="Select all visible"
            />
          </th>
        )}
        <th className="w-6 p-2"></th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Account</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Requisition</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Month</th>
        <th className="text-center p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Pos</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Client SPOC</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Department</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Start Date</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Close Date</th>
        <th className="text-center p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]" title="Days since Start Date">Ageing</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Status</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">TA Stage</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Risk</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]" title="Manually set probability. Blank = use AI.">Prob</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]" title="Auto-calculated from status updates">AI Prob</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px] min-w-[180px]">Add Update</th>
        <th className="w-8 p-2"></th>
      </tr>
    </thead>
  );

  /** Renders one tier's Active Requisitions Card. Tier 1 stays open and gets
   *  a primary-accent left border to draw the eye; Tier 2 is collapsible so
   *  the strategic list stays visible when you're scanning the top of the
   *  page. Both share the same table + section-header rendering as before
   *  so account grouping still works. */
  const ActiveReqsBlock = ({
    title, subtitle, tier, rows, collapsibleDefault = false, emptyMsg,
  }: {
    title: string;
    subtitle: string;
    tier: 1 | 2;
    rows: StaffingRow[];
    collapsibleDefault?: boolean;
    emptyMsg: string;
  }) => {
    // Local collapse state, per instance. Tier 1 defaults to open.
    // Tier 2 defaults to open if it has data — we want visibility by
    // default and only collapse if the user actively minimizes it.
    const [collapsed, setCollapsed] = useState(collapsibleDefault && rows.length > 10);
    const totalPositions = rows.reduce((s, r) => s + r.openPositions, 0);
    const distinctAccounts = new Set(rows.map((r) => r.account)).size;
    const totalCols = 18; // must match TableHeader with selectable=true

    return (
      <Card className={`mb-4 ${tier === 1 ? 'border-l-4 border-l-primary bg-primary/[0.02]' : ''}`}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-full flex items-center justify-between mb-3 text-left"
        >
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className={`font-bold text-sm ${tier === 1 ? 'text-primary' : 'text-slate-700'}`}>{title}</h3>
            <span className="text-[11px] text-slate-500">{subtitle}</span>
            {rows.length > 0 && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {distinctAccounts} {distinctAccounts === 1 ? 'account' : 'accounts'} · {rows.length} reqs · {totalPositions} open positions
              </span>
            )}
          </div>
          {collapsed ? <ChevronRight size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {!collapsed && (rows.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-4 text-center">{emptyMsg}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <TableHeader selectable />
              <tbody>
                {(() => {
                  const ordered = groupByAccount
                    ? [...rows].sort((a, b) => a.account.localeCompare(b.account) || b.aiProbability - a.aiProbability)
                    : rows;
                  let prevAccount: string | null = null;
                  return ordered.map((r) => {
                    const showHeader = groupByAccount && r.account !== prevAccount;
                    if (showHeader) prevAccount = r.account;
                    let sectionReqs = 0, sectionPositions = 0, sectionAvgAi = 0;
                    if (showHeader) {
                      const same = ordered.filter((x) => x.account === r.account);
                      sectionReqs = same.length;
                      sectionPositions = same.reduce((s, x) => s + x.openPositions, 0);
                      sectionAvgAi = same.length ? Math.round(same.reduce((s, x) => s + x.aiProbability, 0) / same.length) : 0;
                    }
                    return (
                      <Fragment key={`tier${tier}-row-${r.id}`}>
                        {showHeader && (
                          <tr className={`border-y-2 ${tier === 1 ? 'border-primary/30 bg-primary/5' : 'border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50'}`}>
                            <td colSpan={totalCols} className="py-2 px-3">
                              <div className="flex items-baseline gap-3 flex-wrap">
                                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${tier === 1 ? 'bg-primary/20 text-primary' : 'bg-primary/15 text-primary'}`}>
                                  <Building2 size={14} />
                                </span>
                                <span className="text-base font-extrabold text-slate-900 tracking-tight">{r.account}</span>
                                <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${tier === 1 ? 'bg-primary text-white' : 'bg-slate-200 text-slate-600'}`}>
                                  Tier {tier}
                                </span>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                                  {sectionReqs} {sectionReqs === 1 ? 'req' : 'reqs'}
                                  <span className="text-slate-300 mx-1">·</span>
                                  <span className="text-slate-700">{sectionPositions}</span> open positions
                                  <span className="text-slate-300 mx-1">·</span>
                                  avg AI prob <span className="text-slate-700">{sectionAvgAi}%</span>
                                </span>
                              </div>
                            </td>
                          </tr>
                        )}
                        {renderRow(r, { selectable: true, hideAccount: groupByAccount })}
                      </Fragment>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        ))}
      </Card>
    );
  };

  return (
    <>
      <PageHeader title="India Staffing" subtitle="Real-time staffing tracker with AI-powered closure forecasting" />

      {/* AI Daily Briefing — top-of-page summary of what changed + what needs attention. */}
      <div className="mb-5 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-violet-100">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-violet-600" />
            <span className="text-sm font-bold text-slate-800">Daily Briefing</span>
            <span className="bg-gradient-to-r from-violet-500 to-blue-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">AI</span>
            {briefing?.generatedAt && (
              <span className="text-[10px] text-slate-400">
                · updated {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={regenerateBriefing}
              disabled={briefingLoading}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
              title="Regenerate briefing with the latest data"
            >
              {briefingLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {briefingLoading ? 'Generating' : 'Regenerate'}
            </button>
            <button
              onClick={() => setBriefingExpanded((v) => !v)}
              className="p-1 rounded text-slate-400 hover:bg-slate-100"
              title={briefingExpanded ? 'Collapse' : 'Expand'}
            >
              {briefingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
        </div>
        {briefingExpanded && (
          <div className="px-4 py-3">
            {briefingLoading && !briefing && (
              <div className="text-xs text-slate-400 italic flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Claude is reviewing your pipeline...
              </div>
            )}
            {briefing && (
              <div className="text-[12px] leading-relaxed text-slate-700 [&_strong]:text-slate-900 [&_em]:text-slate-500">
                {briefing.markdown.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
                  const content = isBullet ? trimmed.slice(2) : trimmed;
                  const parts = content.split(/(\*\*[^*]+\*\*|_[^_]+_)/).filter(Boolean);
                  return (
                    <p key={i} className={`${isBullet ? 'ml-4 before:content-["•"] before:mr-2 before:text-violet-400' : ''} my-1`}>
                      {parts.map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) return <strong key={j}>{part.slice(2, -2)}</strong>;
                        if (part.startsWith('_') && part.endsWith('_')) return <em key={j}>{part.slice(1, -1)}</em>;
                        return <span key={j}>{part}</span>;
                      })}
                    </p>
                  );
                })}
              </div>
            )}
            {briefing?.alerts && briefing.alerts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-violet-100 flex flex-wrap gap-1.5">
                {briefing.alerts.map((a, i) => {
                  const req = requisitions.find((r) => r.id === a.requisitionId);
                  if (!req) return null;
                  const acct = accountNameById[req.account_id] || 'Unknown';
                  const bg = a.severity === 'high' ? 'bg-red-100 text-red-800' : a.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800';
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${bg}`} title={`${acct} — ${req.title}`}>
                      <AlertTriangle size={10} /> {acct}: {a.message}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Smart Query — natural-language Q&A over the full staffing data */}
      <StaffingSmartQuery input={{ accounts, requisitions, statuses, history, candidates }} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
          <option value="all">All Months</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="all">All Accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
        </select>
        <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
          <option value="all">All Risk Levels</option>
          <option value="high">High Risk</option>
          <option value="medium">Medium Risk</option>
          <option value="low">Low Risk</option>
        </select>
        <div className="flex-1" />
        {(() => {
          // Count active reqs that haven't been status-updated today.
          const today = new Date().toISOString().slice(0, 10);
          const haveTodayStatus = new Set(statuses.filter((s) => s.status_date === today).map((s) => s.requisition_id));
          const pendingCount = requisitions.filter(
            (r) => !ARCHIVED_STATUSES.includes(r.status_field) && !haveTodayStatus.has(r.id),
          ).length;
          return (
            <button onClick={() => setDailyStatusOpen(true)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors ${
                      pendingCount > 0
                        ? 'bg-violet-600 text-white hover:bg-violet-700'
                        : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                    title="Update today's statuses across all active requisitions in one focused flow">
              <ClipboardList size={14} /> Daily Status
              {pendingCount > 0 && (
                <span className="bg-white/30 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full">{pendingCount}</span>
              )}
            </button>
          );
        })()}
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium hover:bg-slate-50">
          <Upload size={14} /> Import CSV
        </button>
        <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium hover:bg-slate-50">
          <Download size={14} /> Export
        </button>
        <button onClick={() => setShowAddForm(!showAddForm)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark shadow-sm">
          <Plus size={14} /> Add Requisition
        </button>
      </div>

      {/* Add Requisition Form */}
      {showAddForm && (
        <div className="bg-white border border-blue-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-slate-800">New Requisition</h3>
            <button onClick={() => setShowAddForm(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400"><X size={16} /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Account */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Account</label>
              <select
                value={newReq.accountId}
                onChange={(e) => setNewReq({ ...newReq, accountId: e.target.value, newAccountName: '' })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Select account...</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                <option value="__new__">+ Add New Account</option>
              </select>
            </div>
            {newReq.accountId === '__new__' && (
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">New Account Name</label>
                <input
                  value={newReq.newAccountName}
                  onChange={(e) => setNewReq({ ...newReq, newAccountName: e.target.value })}
                  placeholder="e.g. TCS, Infosys..."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Requisition Title</label>
              <input
                value={newReq.title}
                onChange={(e) => setNewReq({ ...newReq, title: e.target.value })}
                placeholder="e.g. Java Developer, SF Architect..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Month</label>
              <select
                value={newReq.month}
                onChange={(e) => setNewReq({ ...newReq, month: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {ALL_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Positions</label>
              <input
                type="number" min={1}
                value={newReq.positions}
                onChange={(e) => setNewReq({ ...newReq, positions: Number(e.target.value) || 1 })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Start Date</label>
              <input
                type="date"
                value={newReq.startDate}
                onChange={(e) => setNewReq({ ...newReq, startDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Close Date</label>
              <input
                type="date"
                value={newReq.closeByDate}
                onChange={(e) => setNewReq({ ...newReq, closeByDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Expected Closure (text)</label>
              <input
                value={newReq.expectedClosure}
                onChange={(e) => setNewReq({ ...newReq, expectedClosure: e.target.value })}
                placeholder="e.g. April End, TBD..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Client SPOC</label>
              <input
                value={newReq.clientSpoc}
                onChange={(e) => setNewReq({ ...newReq, clientSpoc: e.target.value })}
                placeholder="Contact name..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Department</label>
              <input
                value={newReq.department}
                onChange={(e) => setNewReq({ ...newReq, department: e.target.value })}
                placeholder="e.g. Engineering..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowAddForm(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={handleAddRequisition}
              disabled={(!newReq.accountId || (newReq.accountId === '__new__' && !newReq.newAccountName.trim())) || !newReq.title.trim()}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-dark shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-2"><Plus size={14} /> Add Requisition</span>
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-white p-1 rounded-lg shadow-sm mb-6 flex-wrap">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold transition-colors ${activeTab === t.key ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* ====== BOARD TAB ====== */}
      {activeTab === 'board' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-sm">Pipeline Board</h3>
            <span className="text-[10px] text-blue-500 font-medium bg-blue-50 px-2 py-1 rounded-full">
              Drag cards between columns to change stage. Stage changes are audit-logged.
            </span>
          </div>
          <StaffingKanban
            requisitions={requisitions.filter((r) => {
              if (monthFilter !== 'all' && r.month !== monthFilter) return false;
              const acctName = accountNameById[r.account_id];
              if (accountFilter !== 'all' && acctName !== accountFilter) return false;
              return true;
            })}
            history={history}
            accountNameById={accountNameById}
            onMoveStage={(reqId, newStage) => updateRequisition(reqId, { stage: newStage })}
            alerts={briefing?.alerts || []}
          />
        </Card>
      )}

      {/* ====== OVERVIEW TAB ====== */}
      {activeTab === 'overview' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Open Positions" value={totalPos} icon={<Users size={20} />} subtitle={`${filtered.length} active requisitions`} />
            <StatCard label="Closed / Onboarding" value={closedCount} icon={<CheckCircle size={20} />} subtitle={`${closedRows.length} progressing`} />
            <StatCard label="High Risk" value={highRiskCount} icon={<AlertTriangle size={20} />} subtitle={`${filtered.filter((r) => r.risk === 'medium').length} medium`} />
            <StatCard label="Avg Closure Prob" value={`${avgProb}%`} icon={<TrendingUp size={20} />} subtitle="AI + manual blend" />
          </div>

          {/* Funnel + drop-off analysis — collapsible. Default collapsed so
              the requisitions list is above the fold; expand on demand. */}
          <Card className="mb-6">
            <button
              type="button"
              onClick={() => setFunnelExpanded((v) => !v)}
              className="w-full flex items-center justify-between -mx-2 px-2 -my-1 py-1 rounded hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <BarChart3 size={14} className="text-violet-600" />
                <span className="text-sm font-bold text-slate-800">Pipeline funnel + drop-off</span>
                <span className="text-[10px] text-slate-400">{funnelExpanded ? 'click to collapse' : 'click to expand'}</span>
              </div>
              {funnelExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
            </button>
            {funnelExpanded && (
              <div className="mt-3">
                <StageFunnel summary={computeFunnel(requisitions, history)} />
              </div>
            )}
          </Card>

          {/* ── Tier 1 + Tier 2 rendering (extracted so it runs twice) ──
           *  Splits `filtered` by the tier of its owning account, renders
           *  Tier 1 as a prominent, always-open card and Tier 2 as a
           *  collapsible one below. Each section only shows its own
           *  bulk-action bar so selecting doesn't leak across tiers. */}
          {(() => {
            const accountTier = new Map<string, 1 | 2>(accounts.map((a) => [a.id, (a.tier === 1 ? 1 : 2)]));
            const tier1Rows = filtered.filter((r) => accountTier.get(r.account_id) === 1);
            const tier2Rows = filtered.filter((r) => accountTier.get(r.account_id) !== 1);
            return (
              <>
                <ActiveReqsBlock
                  title="Tier 1 · Strategic accounts"
                  subtitle="Persistent, Ciklum — named accounts we can't miss on"
                  tier={1}
                  rows={tier1Rows}
                  emptyMsg="No active Tier 1 requisitions."
                />
                <ActiveReqsBlock
                  title="Tier 2 · Volume accounts"
                  subtitle="Everything else — collapsed by default so Tier 1 stays in focus"
                  tier={2}
                  rows={tier2Rows}
                  collapsibleDefault
                  emptyMsg="No active Tier 2 requisitions."
                />
              </>
            );
          })()}

          {/* -- OLD single-card Active Requisitions kept only as a fallback if
                tier-split needs to be reverted; guarded by `false` so it stays
                out of the render tree. Delete once the split has bedded in. */}
          {false && (<Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-sm">Active Requisitions</h3>
                <button
                  onClick={() => setGroupByAccount((v) => !v)}
                  className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
                    groupByAccount
                      ? 'bg-primary/10 border-primary/40 text-primary font-semibold'
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                  title="Group rows under bold account-name banners"
                >
                  {groupByAccount ? '✓ Grouped by account' : 'Group by account'}
                </button>
              </div>
              <span className="text-[10px] text-blue-500 font-medium bg-blue-50 px-2 py-1 rounded-full">Click any cell to edit | AI Prob auto-updates from status history</span>
            </div>

            {/* Bulk action bar — visible when any rows are checked */}
            {selectedIds.size > 0 && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-slate-900 text-white flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold">
                  {selectedIds.size} selected
                </span>
                <div className="h-4 w-px bg-slate-600" />
                <label className="flex items-center gap-1.5 text-[11px]">
                  Stage →
                  <select
                    className="bg-slate-800 text-white border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                    defaultValue=""
                    disabled={bulkBusy}
                    onChange={(e) => {
                      const next = e.target.value as PipelineStage;
                      if (!next) return;
                      setBulkBusy(true);
                      try {
                        selectedIds.forEach((id) => updateRequisition(id, { stage: next }));
                        setSelectedIds(new Set());
                      } finally { setBulkBusy(false); e.currentTarget.value = ''; }
                    }}
                  >
                    <option value="">Change stage...</option>
                    {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px]">
                  Status →
                  <select
                    className="bg-slate-800 text-white border border-slate-700 rounded px-1.5 py-0.5 text-[11px]"
                    defaultValue=""
                    disabled={bulkBusy}
                    onChange={(e) => {
                      const next = e.target.value as StaffingStatus;
                      if (!next) return;
                      setBulkBusy(true);
                      try {
                        selectedIds.forEach((id) => updateRequisition(id, { status_field: next }));
                        if (next === 'Closed Won') celebrateWin();
                        setSelectedIds(new Set());
                      } finally { setBulkBusy(false); e.currentTarget.value = ''; }
                    }}
                  >
                    <option value="">Change status...</option>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <button
                  onClick={() => {
                    if (!confirm(`Mark ${selectedIds.size} requisitions as Closed Won?`)) return;
                    setBulkBusy(true);
                    try {
                      selectedIds.forEach((id) => updateRequisition(id, { status_field: 'Closed Won' }));
                      celebrateWin();
                      setSelectedIds(new Set());
                    } finally { setBulkBusy(false); }
                  }}
                  disabled={bulkBusy}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Archive size={11} /> Mark Closed Won
                </button>
                <button
                  onClick={() => {
                    if (!confirm(`Delete ${selectedIds.size} requisitions permanently?`)) return;
                    setBulkBusy(true);
                    try {
                      selectedIds.forEach((id) => removeRequisition(id));
                      setSelectedIds(new Set());
                    } finally { setBulkBusy(false); }
                  }}
                  disabled={bulkBusy}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-50"
                >
                  <Trash2 size={11} /> Delete
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-[11px] text-slate-300 hover:text-white"
                >
                  Clear selection
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <TableHeader selectable />
                <tbody>
                  {(() => {
                    // When grouping is on, sort filtered rows by account name
                    // first so all rows for the same account land contiguously.
                    // Within an account, order high-AI-prob → low-AI-prob so the
                    // strongest reqs surface first.
                    const ordered = groupByAccount
                      ? [...filtered].sort((a, b) =>
                          a.account.localeCompare(b.account) ||
                          b.aiProbability - a.aiProbability,
                        )
                      : filtered;
                    let prevAccount: string | null = null;
                    // Total columns must include the bulk-select checkbox + the
                    // expand-chevron + every data column + the trash button so
                    // the section banner spans the whole row width.
                    const totalCols = 18; // selectable=true → 18, see TableHeader
                    return ordered.map((r) => {
                      const showHeader = groupByAccount && r.account !== prevAccount;
                      if (showHeader) prevAccount = r.account;
                      // Pre-compute the section's aggregate stats once per change.
                      let sectionReqs = 0;
                      let sectionPositions = 0;
                      let sectionAvgAi = 0;
                      if (showHeader) {
                        const same = ordered.filter((x) => x.account === r.account);
                        sectionReqs = same.length;
                        // Section header shows OPEN positions (what's still to fill), not the
                        // original count. Filled candidates have already moved on.
                        sectionPositions = same.reduce((s, x) => s + x.openPositions, 0);
                        sectionAvgAi = same.length
                          ? Math.round(same.reduce((s, x) => s + x.aiProbability, 0) / same.length)
                          : 0;
                      }
                      return (
                        <Fragment key={`row-${r.id}`}>
                          {showHeader && (
                            <tr className="border-y-2 border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50">
                              <td colSpan={totalCols} className="py-2.5 px-3">
                                <div className="flex items-baseline gap-3">
                                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/15 text-primary flex-shrink-0">
                                    <Building2 size={14} />
                                  </span>
                                  <span className="text-base font-extrabold text-slate-900 tracking-tight">
                                    {r.account}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                                    {sectionReqs} {sectionReqs === 1 ? 'req' : 'reqs'}
                                    <span className="text-slate-300 mx-1">·</span>
                                    <span className="text-slate-700">{sectionPositions}</span> open positions
                                    <span className="text-slate-300 mx-1">·</span>
                                    avg AI prob <span className="text-slate-700">{sectionAvgAi}%</span>
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )}
                          {renderRow(r, { selectable: true, hideAccount: groupByAccount })}
                        </Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </Card>)}

          {/* Archived — split into two buckets:
           *   1. Closed Won (celebrated, kept separate)
           *   2. Closed Lost / Cancelled (grouped — both are non-wins)
           */}
          {(() => {
            const wonRows = archivedRows.filter((r) => isClosedWon(r.statusField));
            const lostRows = archivedRows.filter((r) => isLostOrCancelled(r.statusField));
            return (
              <>
                <Card className="mt-6">
                  <button
                    onClick={() => setShowArchive((v) => !v)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Archive size={14} className="text-emerald-500" />
                      <h3 className="font-bold text-sm">Closed Won</h3>
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold">
                        {wonRows.length} won
                      </span>
                    </div>
                    {showArchive ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                  </button>
                  {showArchive && (
                    <div className="overflow-x-auto mt-4">
                      {wonRows.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-4 text-center">No wins yet — go close a deal.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <TableHeader />
                          <tbody>
                            {wonRows.map((r) => renderRow(r, { archived: true }))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </Card>

                <Card className="mt-6">
                  <button
                    onClick={() => setShowArchive((v) => !v)}
                    className="w-full flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Archive size={14} className="text-slate-400" />
                      <h3 className="font-bold text-sm">Closed Lost / Cancelled</h3>
                      <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {lostRows.length}
                      </span>
                    </div>
                    {showArchive ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                  </button>
                  {showArchive && (
                    <div className="overflow-x-auto mt-4">
                      {lostRows.length === 0 ? (
                        <p className="text-xs text-slate-400 italic py-4 text-center">Nothing lost or cancelled.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <TableHeader />
                          <tbody>
                            {lostRows.map((r) => renderRow(r, { archived: true }))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </Card>
              </>
            );
          })()}
        </>
      )}

      {/* ====== ACCOUNTS TAB ====== */}
      {activeTab === 'accounts' && (() => {
        // Build enriched account summaries, sorted by forecast revenue desc.
        const summaries = [...accountGroups.entries()].map(([name, rws]) => {
          const openPos = rws.reduce((s, r) => s + (r.openPositions ?? r.newPositions), 0);
          const avg = rws.length ? Math.round(rws.reduce((s, r) => s + r.closureProb, 0) / rws.length) : 0;
          const hr = rws.filter((r) => r.risk === 'high').length;
          const insight: AccountInsight | undefined = salesPlanByName[(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()];
          const forecast = insight?.forecast ?? 0;
          const secured = insight?.secured ?? 0;
          const unsecured = insight?.unsecured ?? 0;
          const pctLocked = insight?.pctLocked ?? 0;
          // Urgency: meaningful unsecured ($) AND poor coverage. Tunable thresholds.
          const urgent = forecast > 0 && unsecured >= 250_000 && pctLocked < 0.4;
          // Health: combines forecast coverage + delivery prob + risk count.
          let health: 'healthy' | 'watch' | 'critical' = 'watch';
          if (avg >= 60 && hr === 0 && (pctLocked >= 0.4 || forecast === 0)) health = 'healthy';
          else if (avg <= 30 || hr >= 2 || urgent) health = 'critical';
          return { name, rws, openPos, avg, hr, insight, forecast, secured, unsecured, pctLocked, urgent, health };
        });
        summaries.sort((a, b) => {
          if (b.forecast !== a.forecast) return b.forecast - a.forecast;
          return a.name.localeCompare(b.name);
        });
        const urgentCount = summaries.filter((s) => s.urgent).length;
        const totalForecast = summaries.reduce((s, x) => s + x.forecast, 0);
        const totalSecured = summaries.reduce((s, x) => s + x.secured, 0);
        const totalUnsecured = Math.max(0, totalForecast - totalSecured);

        const fmtMoney = (n: number) => {
          if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
          if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
          return `$${n.toFixed(0)}`;
        };
        const fmtAgo = (iso?: string) => {
          if (!iso) return null;
          const ms = Date.now() - new Date(iso).getTime();
          if (!Number.isFinite(ms) || ms < 0) return null;
          const d = Math.round(ms / 86400000);
          if (d <= 0) return 'today';
          if (d === 1) return '1d ago';
          if (d < 30) return `${d}d ago`;
          const mo = Math.round(d / 30);
          return mo === 1 ? '1mo ago' : `${mo}mo ago`;
        };

        const selectedSummary = selectedAccount ? summaries.find((s) => s.name === selectedAccount) : null;

        return (
          <>
            {/* Portfolio summary strip — total forecast, secured, unsecured, urgent count */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1"><Building2 size={11} /> Accounts</div>
                <div className="text-xl font-extrabold text-slate-800">{summaries.length}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{summaries.filter((s) => s.forecast > 0).length} in sales plan</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1 flex items-center gap-1"><DollarSign size={11} /> Forecast 2026</div>
                <div className="text-xl font-extrabold text-slate-800"><Sensitive>{fmtMoney(totalForecast)}</Sensitive></div>
                <div className="text-[10px] text-slate-500 mt-0.5">across {summaries.length} accounts</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1 flex items-center gap-1"><Lock size={11} /> Secured</div>
                <div className="text-xl font-extrabold text-emerald-700"><Sensitive>{fmtMoney(totalSecured)}</Sensitive></div>
                <div className="text-[10px] text-emerald-600/80 mt-0.5">{totalForecast > 0 ? `${Math.round((totalSecured / totalForecast) * 100)}% of plan locked` : '—'}</div>
              </div>
              <div className={`rounded-xl border p-3 ${urgentCount > 0 ? 'border-rose-300 bg-rose-50/60' : 'border-amber-200 bg-amber-50/40'}`}>
                <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 flex items-center gap-1 ${urgentCount > 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                  <Unlock size={11} /> Unsecured
                </div>
                <div className={`text-xl font-extrabold ${urgentCount > 0 ? 'text-rose-700' : 'text-amber-700'}`}><Sensitive>{fmtMoney(totalUnsecured)}</Sensitive></div>
                <div className={`text-[10px] mt-0.5 ${urgentCount > 0 ? 'text-rose-600' : 'text-amber-600/80'}`}>
                  {urgentCount > 0 ? `${urgentCount} account${urgentCount === 1 ? '' : 's'} need sales+delivery sync` : 'No urgent accounts'}
                </div>
              </div>
            </div>

            {/* Status banner — sales plan source & freshness */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-[11px] text-slate-500">
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

            {/* Account cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
              {summaries.map((s) => {
                const lockedPct = Math.round(s.pctLocked * 100);
                const healthMeta = {
                  healthy: { dot: 'bg-emerald-500', label: 'Healthy', cls: 'text-emerald-700 bg-emerald-50' },
                  watch: { dot: 'bg-amber-500', label: 'Watch', cls: 'text-amber-700 bg-amber-50' },
                  critical: { dot: 'bg-rose-500', label: 'Critical', cls: 'text-rose-700 bg-rose-50' },
                }[s.health];
                const lastTouch = fmtAgo(s.insight?.lastTouch);
                const staleTouch = !lastTouch || (s.insight?.lastTouch && (Date.now() - new Date(s.insight.lastTouch).getTime()) > 45 * 86400000);
                const isSelected = selectedAccount === s.name;
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={s.name}
                    onClick={() => { setSelectedAccount(isSelected ? null : s.name); setAccountDetailTab('reqs'); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAccount(isSelected ? null : s.name); setAccountDetailTab('reqs'); } }}
                    className={`text-left rounded-xl bg-white border transition-all relative overflow-hidden group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                      s.urgent
                        ? 'border-rose-300 ring-1 ring-rose-200 hover:ring-rose-300 hover:shadow-lg'
                        : 'border-slate-200 hover:border-primary/40 hover:shadow-md'
                    } ${isSelected ? 'ring-2 ring-primary/60' : ''}`}
                  >
                    {s.urgent && (
                      <div className="absolute top-0 left-0 right-0 bg-rose-600 text-white text-[9px] font-bold uppercase tracking-wider px-3 py-0.5 flex items-center gap-1">
                        <Flame size={10} /> Urgent: Sales + Delivery sync needed
                      </div>
                    )}
                    <div className={`p-3.5 ${s.urgent ? 'pt-6' : ''}`}>
                      {/* Header: name + health */}
                      <div className="flex items-start justify-between gap-2 mb-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm text-slate-800 truncate">{s.name}</div>
                          <div className="text-[10px] text-slate-500 truncate">
                            {s.insight?.salesRep ? `${s.insight.salesRep}` : 'No sales owner'}
                            {s.insight?.segment ? ` · ${s.insight.segment}` : ''}
                          </div>
                        </div>
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 shrink-0 ${healthMeta.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${healthMeta.dot}`} />
                          {healthMeta.label}
                        </span>
                      </div>

                      {/* Forecast — big number */}
                      {s.forecast > 0 ? (
                        <>
                          <div className="flex items-baseline justify-between mb-1">
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Forecast '26</span>
                            <span className="text-[10px] text-slate-400">{lockedPct}% locked</span>
                          </div>
                          <div className="text-2xl font-extrabold text-slate-800 mb-2 leading-none">
                            <Sensitive>{fmtMoney(s.forecast)}</Sensitive>
                          </div>
                          {/* Secured / unsecured split bar */}
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex mb-1.5">
                            <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(100, lockedPct)}%` }} title={`Secured ${fmtMoney(s.secured)}`} />
                            <div className={`${s.urgent ? 'bg-rose-400' : 'bg-amber-400'} h-full`} style={{ width: `${100 - Math.min(100, lockedPct)}%` }} title={`Unsecured ${fmtMoney(s.unsecured)}`} />
                          </div>
                          <div className="flex justify-between text-[10px] mb-3">
                            <span className="text-emerald-700 font-semibold inline-flex items-center gap-0.5"><Lock size={9} /><Sensitive>{fmtMoney(s.secured)}</Sensitive></span>
                            <span className={`font-semibold inline-flex items-center gap-0.5 ${s.urgent ? 'text-rose-700' : 'text-amber-700'}`}><Unlock size={9} /><Sensitive>{fmtMoney(s.unsecured)}</Sensitive></span>
                          </div>
                        </>
                      ) : (
                        <a
                          href="https://simpliigence-sales-planning-2026.vercel.app/"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mb-3 px-2 py-1.5 rounded-md bg-slate-50 border border-dashed border-slate-200 text-[10px] text-slate-500 hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors flex items-center justify-between gap-2"
                          title={`Open 2026 Sales Plan to add a forecast for ${s.name}`}
                        >
                          <span className="italic truncate">Not in sales plan — add a forecast</span>
                          <span className="font-semibold whitespace-nowrap">↗ Open</span>
                        </a>
                      )}

                      {/* Delivery snapshot */}
                      <div className="grid grid-cols-3 gap-2 mb-2 text-center">
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Reqs</div>
                          <div className="text-sm font-bold text-slate-700">{s.rws.length}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Open pos</div>
                          <div className="text-sm font-bold text-slate-700">{s.openPos}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">High risk</div>
                          <div className={`text-sm font-bold ${s.hr > 0 ? 'text-rose-600' : 'text-slate-700'}`}>{s.hr}</div>
                        </div>
                      </div>

                      {/* Connects strip */}
                      <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-[10px]">
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <Activity size={10} className={s.insight && s.insight.signalCount > 0 ? 'text-violet-500' : 'text-slate-300'} />
                          {s.insight && s.insight.signalCount > 0
                            ? <><strong className="text-slate-700">{s.insight.signalCount}</strong> active connect{s.insight.signalCount === 1 ? '' : 's'}</>
                            : <span className="text-slate-400">No active connects</span>}
                        </span>
                        {lastTouch ? (
                          <span className={`inline-flex items-center gap-1 ${staleTouch ? 'text-amber-600' : 'text-slate-500'}`}>
                            <Clock size={10} /> {lastTouch}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </div>

                      {s.insight && s.insight.openPipeline > 0 && (
                        <div className="mt-1.5 text-[10px] text-slate-500">
                          Open pipeline: <strong className="text-slate-700"><Sensitive>{fmtMoney(s.insight.openPipeline)}</Sensitive></strong>
                          {' · '}
                          weighted: <strong className="text-slate-700"><Sensitive>{fmtMoney(s.insight.weightedPipeline)}</Sensitive></strong>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Selected-account drill-down with sub-tabs */}
            {selectedSummary && (
              <Card>
                <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-bold text-base text-slate-800">{selectedSummary.name}</h3>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {selectedSummary.insight?.salesRep ? `Sales: ${selectedSummary.insight.salesRep}` : 'No sales owner'}
                      {selectedSummary.insight?.segment ? ` · ${selectedSummary.insight.segment}` : ''}
                      {selectedSummary.forecast > 0 && (
                        <> · Forecast <Sensitive>{fmtMoney(selectedSummary.forecast)}</Sensitive> · <Sensitive>{fmtMoney(selectedSummary.secured)}</Sensitive> locked / <Sensitive>{fmtMoney(selectedSummary.unsecured)}</Sensitive> to-get</>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedAccount(null)}
                    className="text-slate-400 hover:text-slate-700 text-xs inline-flex items-center gap-1"
                  >
                    <X size={12} /> Close
                  </button>
                </div>

                {/* Sub-tab nav */}
                <div className="flex gap-1 mb-4 border-b border-slate-200">
                  {([
                    { key: 'reqs' as const, label: 'Requisitions', icon: Briefcase, count: selectedSummary.rws.length },
                    { key: 'forecast' as const, label: 'Forecast breakdown', icon: TrendingUp, count: selectedSummary.forecast > 0 ? selectedSummary.insight?.monthly.filter((m) => m.value > 0).length : null },
                    { key: 'connects' as const, label: 'Connects & signals', icon: MessageCircle, count: selectedSummary.insight?.signalCount ?? null },
                  ]).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setAccountDetailTab(t.key)}
                      className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 border-b-2 transition-colors ${
                        accountDetailTab === t.key
                          ? 'border-primary text-primary'
                          : 'border-transparent text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <t.icon size={12} />
                      {t.label}
                      {t.count != null && t.count > 0 && (
                        <span className={`ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold ${
                          accountDetailTab === t.key ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'
                        }`}>{t.count}</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab body */}
                {accountDetailTab === 'reqs' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b-2 border-slate-100">
                          <th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Requisition</th>
                          <th className="p-2">Month</th>
                          <th className="p-2">Pos</th>
                          <th className="p-2">Ageing</th>
                          <th className="p-2">TA Stage</th>
                          <th className="p-2">Risk</th>
                          <th className="p-2">Prob</th>
                          <th className="p-2">AI Prob</th>
                          <th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSummary.rws.map((r) => (
                          <tr key={r.id} className="border-b border-slate-50">
                            <td className="p-2 font-semibold">{r.requisition}</td>
                            <td className="p-2">{r.month}</td>
                            <td className="p-2 text-center font-bold" title={`${r.openPositions} open · ${r.filledPositions} filled · ${r.newPositions} total`}>
                              {r.filledPositions > 0 ? <><span className={r.openPositions === 0 ? 'text-emerald-600' : ''}>{r.openPositions}</span><span className="text-slate-400">/{r.newPositions}</span></> : r.newPositions}
                            </td>
                            <td className="p-2 text-center">{r.startDate ? `${r.ageing}d` : '—'}</td>
                            <td className="p-2"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: STAGE_COLORS[r.stage] }}>{r.stage}</span></td>
                            <td className="p-2"><StatusBadge status={r.risk === 'high' ? 'at-risk' : r.risk === 'medium' ? 'caution' : 'on-track'} label={r.risk} /></td>
                            <td className="p-2 font-bold">{r.probability > 0 ? `${r.probability}%` : '—'}</td>
                            <td className="p-2 font-bold">{r.aiProbability}%</td>
                            <td className="p-2 text-slate-500 text-[11px] max-w-sm truncate">{r.status.split('\n')[0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {accountDetailTab === 'forecast' && (
                  selectedSummary.insight && selectedSummary.forecast > 0 ? (
                    <div>
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4">
                        {selectedSummary.insight.monthly.map((m) => {
                          const max = Math.max(...selectedSummary.insight!.monthly.map((x) => x.value), 1);
                          const pct = Math.round((m.value / max) * 100);
                          return (
                            <div key={m.month} className="rounded-lg border border-slate-200 bg-white p-2">
                              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-1">{m.month.toUpperCase()}</div>
                              <div className="text-sm font-bold text-slate-800"><Sensitive>{fmtMoney(m.value)}</Sensitive></div>
                              <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                          <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold mb-1 flex items-center gap-1"><Lock size={10} /> Secured</div>
                          <div className="text-lg font-extrabold text-emerald-700"><Sensitive>{fmtMoney(selectedSummary.secured)}</Sensitive></div>
                          <div className="text-[10px] text-emerald-600/80 mt-0.5">{Math.round(selectedSummary.pctLocked * 100)}% of forecast</div>
                        </div>
                        <div className={`rounded-lg border p-3 ${selectedSummary.urgent ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
                          <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 flex items-center gap-1 ${selectedSummary.urgent ? 'text-rose-700' : 'text-amber-700'}`}><Unlock size={10} /> To-get / Unsecured</div>
                          <div className={`text-lg font-extrabold ${selectedSummary.urgent ? 'text-rose-700' : 'text-amber-700'}`}><Sensitive>{fmtMoney(selectedSummary.unsecured)}</Sensitive></div>
                          <div className={`text-[10px] mt-0.5 ${selectedSummary.urgent ? 'text-rose-600' : 'text-amber-600/80'}`}>{selectedSummary.urgent ? 'Urgent — sync sales & delivery' : 'Coverage acceptable'}</div>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1 flex items-center gap-1"><Activity size={10} /> Pipeline coverage</div>
                          <div className="text-lg font-extrabold text-slate-800"><Sensitive>{fmtMoney(selectedSummary.insight.openPipeline)}</Sensitive></div>
                          <div className="text-[10px] text-slate-500 mt-0.5">weighted <Sensitive>{fmtMoney(selectedSummary.insight.weightedPipeline)}</Sensitive></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic py-6 text-center">
                      This account isn't in the 2026 Sales Plan yet. Open the sales plan to add a forecast.
                    </div>
                  )
                )}

                {accountDetailTab === 'connects' && (
                  selectedSummary.insight && selectedSummary.insight.signals.length > 0 ? (
                    <div className="space-y-2">
                      {selectedSummary.insight.signals
                        .slice()
                        .sort((a, b) => ((b.updates?.[b.updates.length - 1]?.ts || b.createdAt || '') > (a.updates?.[a.updates.length - 1]?.ts || a.createdAt || '') ? 1 : -1))
                        .map((sig) => {
                          const ts = sig.updates && sig.updates.length ? sig.updates[sig.updates.length - 1].ts : sig.createdAt;
                          const kindCls: Record<string, string> = {
                            opportunity: 'bg-violet-100 text-violet-700',
                            conversation: 'bg-sky-100 text-sky-700',
                            risk: 'bg-rose-100 text-rose-700',
                            note: 'bg-slate-100 text-slate-600',
                          };
                          const sentimentDot: Record<string, string> = {
                            positive: 'bg-emerald-500',
                            neutral: 'bg-slate-400',
                            negative: 'bg-rose-500',
                          };
                          return (
                            <div key={sig.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full ${sentimentDot[sig.sentiment || 'neutral'] || sentimentDot.neutral}`} />
                                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${kindCls[sig.kind] || kindCls.note}`}>{sig.kind}</span>
                                  {sig.owner && <span className="text-[10px] text-slate-500">· {sig.owner}</span>}
                                </span>
                                <span className="text-[10px] text-slate-400">{ts ? new Date(ts).toLocaleDateString() : ''}</span>
                              </div>
                              {sig.text && <div className="text-slate-700">{sig.text}</div>}
                              {sig.kind === 'opportunity' && (sig.amount || sig.stage || sig.probability != null) && (
                                <div className="mt-1.5 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                                  {sig.amount != null && <span>Amount: <strong className="text-slate-700"><Sensitive>{fmtMoney(sig.amount)}</Sensitive></strong></span>}
                                  {sig.stage && <span>Stage: <strong className="text-slate-700">{sig.stage}</strong></span>}
                                  {sig.probability != null && <span>Prob: <strong className="text-slate-700">{sig.probability}%</strong></span>}
                                  {sig.closeDate && <span>Close: <strong className="text-slate-700">{sig.closeDate}</strong></span>}
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic py-6 text-center">
                      No active connects yet. Sales activity logged in the 2026 Sales Plan will appear here.
                    </div>
                  )
                )}
              </Card>
            )}
          </>
        );
      })()}

      {/* ====== FORECAST TAB ====== */}
      {activeTab === 'forecast' && (
        <>
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-6 mb-6 text-white">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-bold text-base">AI-Powered Closure Forecast</h2>
              <span className="bg-gradient-to-r from-violet-500 to-blue-500 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide">AI Insights</span>
            </div>
            <p className="text-slate-400 text-xs mb-5">Based on status velocity, sentiment analysis, and pipeline stage (manual Prob overrides AI when set)</p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {[
                { label: 'Optimistic', val: optimistic, color: '#10b981', conf: 40 },
                { label: 'Realistic', val: realistic, color: '#3b82f6', conf: 70 },
                { label: 'Conservative', val: conservative, color: '#f59e0b', conf: 90 },
                { label: 'At Risk', val: filtered.filter((r) => r.risk === 'high').reduce((s, r) => s + r.openPositions, 0), color: '#ef4444', conf: 85 },
              ].map((s) => (
                <div key={s.label} className="bg-white/5 border border-white/10 rounded-lg p-4">
                  <h4 className="text-blue-300 text-xs font-semibold mb-2">{s.label}</h4>
                  <div className="text-2xl font-extrabold mb-1" style={{ color: s.color }}>{s.val} <span className="text-sm text-slate-400 font-normal">of {totalPos}</span></div>
                  <div className="h-1 bg-white/10 rounded mt-3 overflow-hidden"><div className="h-full rounded" style={{ width: `${s.conf}%`, background: s.color }} /></div>
                  <p className="text-[10px] text-slate-500 text-right mt-1">{s.conf}% confidence</p>
                </div>
              ))}
            </div>
          </div>
          <Card>
            <h3 className="font-bold text-sm mb-3">Forecast Reasoning by Requisition</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b-2 border-slate-100"><th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Account</th><th className="p-2">Requisition</th><th className="p-2">TA Stage</th><th className="p-2">Ageing</th><th className="p-2">Prob</th><th className="p-2">Risk</th><th className="p-2">Recommendation</th></tr></thead>
                <tbody>
                  {[...filtered].sort((a, b) => b.closureProb - a.closureProb).map((r) => {
                    let rec = 'Monitor';
                    if (r.risk === 'high') rec = 'Escalate & parallel source';
                    else if (r.stage === 'Sourcing') rec = 'Accelerate sourcing';
                    else if (r.stage === 'Client Round') rec = 'Follow up with client';
                    else if (r.stage === 'Onboarding') rec = 'Track onboarding';
                    return (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="p-2 font-bold">{r.account}</td><td className="p-2">{r.requisition}</td>
                        <td className="p-2"><span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: STAGE_COLORS[r.stage] }}>{r.stage}</span></td>
                        <td className="p-2 text-center">{r.startDate ? `${r.ageing}d` : '—'}</td>
                        <td className="p-2 font-bold">{r.closureProb}%</td>
                        <td className="p-2"><StatusBadge status={r.risk === 'high' ? 'at-risk' : r.risk === 'medium' ? 'caution' : 'on-track'} label={r.risk} /></td>
                        <td className="p-2 text-slate-500">{rec}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ── Send-to-Vendor dialog ── */}
      {sendVendorReqId && (() => {
        const r = requisitions.find((x) => x.id === sendVendorReqId);
        if (!r) return null;
        const acct = accounts.find((a) => a.id === r.account_id);
        return (
          <SendToVendorDialog
            requisition={r}
            accountName={acct?.name ?? ''}
            onClose={() => setSendVendorReqId(null)}
          />
        );
      })()}

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
                    {reqRow?.title || 'Job description'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                    {acctName}
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
                  <button
                    onClick={copyJd}
                    disabled={!jdText || jdState === 'loading'}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 disabled:opacity-40"
                  >Copy</button>
                  <button
                    onClick={() => openJdDrawer(jdReqId, { regenerate: true })}
                    disabled={jdState === 'loading'}
                    className="text-xs font-semibold bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-md hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-1"
                    title="Throw away current JD and ask Claude for a fresh draft"
                  >
                    <RefreshCw size={12} /> Regenerate
                  </button>
                  <button
                    onClick={saveJd}
                    disabled={!jdDirty || jdState === 'saving' || jdState === 'loading'}
                    className="text-xs font-semibold bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1"
                  >
                    <Save size={12} /> {jdState === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Quick-add speed-dial — bottom-right floating button + menu ── */}
      <QuickAddSpeedDial
        accounts={accounts}
        onAddAccount={async (name) => {
          // Reuse the same addAccount path used by the legacy Add Req form.
          return addAccount(name);
        }}
        onAddRequisition={async ({ accountId, title, month }) => {
          await addRequisition({
            account_id: accountId,
            title,
            month,
            new_positions: 1,
            stage: 'Sourcing',
            status_field: 'In Progress',
            anticipation: '',
            client_spoc: '',
            department: '',
            location: '',
            expected_closure: '',
            close_by_date: '',
            start_date: new Date().toISOString().slice(0, 10),
            probability: 0,
            ai_probability: 0,
          });
        }}
      />

      {/* ── Daily Status mode — focused overlay for bulk-logging statuses ── */}
      {dailyStatusOpen && (
        <DailyStatusMode
          requisitions={requisitions}
          statuses={statuses}
          accounts={accounts}
          onAddStatus={async (p) => { await addStatus(p); }}
          onClose={() => setDailyStatusOpen(false)}
        />
      )}
    </>
  );
}
