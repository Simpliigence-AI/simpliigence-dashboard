// @ts-nocheck
import React, { useState, useMemo, useRef, useCallback, useEffect, Fragment } from 'react';
import {
  Users, AlertTriangle, TrendingUp, CheckCircle, Upload,
  Download, Brain, BarChart3, Building2, Pencil, Trash2, Save, X, ChevronDown, ChevronRight, Plus, Archive, History,
  Columns, RefreshCw, Sparkles, Loader2, Clock,
} from 'lucide-react';
import { useStaffingStore } from '../store/useStaffingStore';
import { analyzeStaffingStatus } from '../lib/staffingAnalysis';
import { computeStageTiming } from '../lib/staffingAlerts';
import { computeFunnel } from '../lib/staffingFunnel';
import { runStaffingBriefing, type StaffingBriefing } from '../lib/claudeQuery';
import { db } from '../lib/supabaseSync';
import { StaffingKanban } from '../components/staffing/StaffingKanban';
import { StageFunnel } from '../components/staffing/StageFunnel';
import { StaffingSmartQuery } from '../components/staffing/StaffingSmartQuery';
import { CandidatePipeline } from '../components/staffing/CandidatePipeline';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, StatusBadge } from '../components/ui';
import type { StaffingRow, RiskLevel, PipelineStage, StaffingStatus } from '../types/staffing';
import { STAGE_COLORS, ARCHIVED_STATUSES } from '../types/staffing';

/* -- Constants -- */
const STATUS_OPTIONS: StaffingStatus[] = ['Open', 'In Progress', 'On Hold', 'Closed', 'Lost', 'Cancelled'];
const STATUS_COLORS: Record<StaffingStatus, string> = {
  'Open': '#3b82f6',
  'In Progress': '#f59e0b',
  'On Hold': '#94a3b8',
  'Closed': '#10b981',
  'Lost': '#b91c1c',
  'Cancelled': '#ef4444',
};
const probColor = (p: number) => p >= 65 ? '#10b981' : p >= 40 ? '#f59e0b' : '#ef4444';
const PIPELINE_STAGES: PipelineStage[] = ['Sourcing','Profiles Shared','Interview','Shortlisted','Client Round','Closed/Selected','Onboarding'];
const ALL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const isArchived = (s: StaffingStatus) => ARCHIVED_STATUSES.includes(s);

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

  if (!editing) {
    return (
      <div
        className={`group cursor-pointer rounded px-1 -mx-1 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all min-h-[24px] flex items-center ${className}`}
        onClick={() => { setDraft(value); setEditing(true); focus(); }}
        title="Click to edit"
      >
        {displayContent || <span>{value}</span>}
        <Pencil size={10} className="ml-1 opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </div>
    );
  }

  if (type === 'select' && options) {
    return (
      <select ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
        className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input ref={inputRef} type={type} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
      className={`w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 ${type === 'number' ? 'w-16 text-center' : ''}`}
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
  const [briefingExpanded, setBriefingExpanded] = useState(true);

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
      return {
        id: req.id, month: req.month, account: acct?.name || 'Unknown', account_id: req.account_id,
        requisition: req.title, newPositions: req.new_positions,
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
  }, [requisitions, statuses, accounts]);

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

  /* -- KPI aggregates (active only) -- */
  const totalPos = filtered.reduce((s, r) => s + r.newPositions, 0);
  const closedRows = filtered.filter((r) => r.stage === 'Closed/Selected' || r.stage === 'Onboarding');
  const closedCount = closedRows.reduce((s, r) => s + r.newPositions, 0);
  const highRiskCount = filtered.filter((r) => r.risk === 'high').length;
  const avgProb = filtered.length ? Math.round(filtered.reduce((s, r) => s + r.closureProb, 0) / filtered.length) : 0;

  /* -- Forecast aggregates -- */
  const optimistic = filtered.filter((r) => r.closureProb >= 40).reduce((s, r) => s + r.newPositions, 0);
  const realistic = filtered.filter((r) => r.closureProb >= 60).reduce((s, r) => s + r.newPositions, 0);
  const conservative = filtered.filter((r) => r.closureProb >= 75).reduce((s, r) => s + r.newPositions, 0);

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
    updateRequisition(reqId, patch);
  }, [updateRequisition]);

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
      status_field: 'Status', stage: 'Stage', anticipation: 'Anticipation',
      client_spoc: 'Client SPOC', department: 'Department',
      probability: 'Prob (manual)', ai_probability: 'AI Prob',
    } as Record<string, string>)[f] || f;

    return (
      <React.Fragment key={r.id}>
        <tr className={`border-b border-slate-50 hover:bg-slate-50/50 ${opts.archived ? 'opacity-75' : ''} ${isChecked ? 'bg-blue-50/40' : ''}`}>
          {opts.selectable && (
            <td className="p-1 text-center">
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
          <td className="p-1 text-center">
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
          {/* Positions */}
          <td className="p-2 text-center">
            <EditableCell value={r.newPositions} type="number" onSave={(val) => handleCellSave(r.id, 'new_positions', val)} className="justify-center" />
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
              className="px-1 py-0.5 text-[11px] border border-slate-200 rounded bg-white hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 w-[120px]"
              onChange={(e) => handleCellSave(r.id, 'start_date', e.target.value)} />
          </td>
          {/* Close Date */}
          <td className="p-2">
            <input type="date" value={r.closeByDate}
              className="px-1 py-0.5 text-[11px] border border-slate-200 rounded bg-white hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 w-[120px]"
              onChange={(e) => handleCellSave(r.id, 'close_by_date', e.target.value)} />
            {r.expectedClosure && <div className="text-[9px] text-slate-400 italic mt-0.5">{r.expectedClosure}</div>}
          </td>
          {/* Ageing */}
          <td className="p-2 text-center">
            <span
              className="font-bold text-[11px] px-2 py-0.5 rounded"
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
              className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const input = e.target as HTMLInputElement;
                  handleInlineStatus(r.id, input.value);
                  input.value = '';
                }
              }}
            />
            {reqStatuses[0] && (
              <div className="text-[9px] text-slate-400 mt-0.5 truncate max-w-[170px]" title={reqStatuses[0].status_text}>
                {reqStatuses[0].status_date.slice(5)}: {reqStatuses[0].status_text}
              </div>
            )}
          </td>
          {/* Delete */}
          <td className="p-1">
            <button
              onClick={() => openJdDrawer(r.id)}
              disabled={jdReqId === r.id && jdState === 'loading'}
              className="p-1 rounded mr-0.5 transition-colors text-slate-300 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50"
              title="Generate / view JD"
            >
              {jdReqId === r.id && jdState === 'loading'
                ? <Loader2 size={12} className="animate-spin" />
                : <Sparkles size={12} />}
            </button>
            <button onClick={() => { if (confirm(`Delete "${r.requisition}"?`)) removeRequisition(r.id); }}
              className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors" title="Delete requisition">
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
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Stage</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]">Risk</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]" title="Manually set probability. Blank = use AI.">Prob</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px]" title="Auto-calculated from status updates">AI Prob</th>
        <th className="text-left p-2 text-slate-400 font-bold uppercase tracking-wide text-[10px] min-w-[180px]">Add Update</th>
        <th className="w-8 p-2"></th>
      </tr>
    </thead>
  );

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

          {/* Funnel + drop-off analysis — reveals bottlenecks at a glance */}
          <Card className="mb-6">
            <StageFunnel summary={computeFunnel(requisitions, history)} />
          </Card>

          <Card>
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
                    if (!confirm(`Archive ${selectedIds.size} requisitions as Closed?`)) return;
                    setBulkBusy(true);
                    try {
                      selectedIds.forEach((id) => updateRequisition(id, { status_field: 'Closed' }));
                      setSelectedIds(new Set());
                    } finally { setBulkBusy(false); }
                  }}
                  disabled={bulkBusy}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Archive size={11} /> Mark Closed
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
                        sectionPositions = same.reduce((s, x) => s + x.newPositions, 0);
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
          </Card>

          {/* Archived (Closed / Lost / Cancelled) — collapsible */}
          <Card className="mt-6">
            <button
              onClick={() => setShowArchive((v) => !v)}
              className="w-full flex items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <Archive size={14} className="text-slate-400" />
                <h3 className="font-bold text-sm">Archived Requisitions</h3>
                <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  {archivedRows.length} — Closed / Lost / Cancelled
                </span>
              </div>
              {showArchive ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            </button>
            {showArchive && (
              <div className="overflow-x-auto mt-4">
                {archivedRows.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-4 text-center">No archived requisitions yet</p>
                ) : (
                  <table className="w-full text-xs">
                    <TableHeader />
                    <tbody>
                      {archivedRows.map((r) => renderRow(r, { archived: true }))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ====== ACCOUNTS TAB ====== */}
      {activeTab === 'accounts' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {[...accountGroups.entries()].map(([name, rws]) => {
              const tot = rws.reduce((s, r) => s + r.newPositions, 0);
              const avg = Math.round(rws.reduce((s, r) => s + r.closureProb, 0) / rws.length);
              const hr = rws.filter((r) => r.risk === 'high').length;
              return (
                <Card key={name} className="cursor-pointer hover:ring-2 hover:ring-primary/30 transition-shadow" onClick={() => setSelectedAccount(selectedAccount === name ? null : name)}>
                  <h4 className="font-bold text-sm mb-3">{name}</h4>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Open Positions</span><span className="font-bold">{tot}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Requisitions</span><span className="font-bold">{rws.length}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Avg Closure Prob</span><span className="font-bold">{avg}%</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">High Risk</span><span className="font-bold text-red-600">{hr}</span></div>
                  </div>
                  <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${avg}%`, background: probColor(avg) }} />
                  </div>
                </Card>
              );
            })}
          </div>
          {selectedAccount && (
            <Card>
              <h3 className="font-bold text-sm mb-3">{selectedAccount} -- Requisition Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b-2 border-slate-100"><th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Requisition</th><th className="p-2">Month</th><th className="p-2">Pos</th><th className="p-2">Ageing</th><th className="p-2">Stage</th><th className="p-2">Risk</th><th className="p-2">Prob</th><th className="p-2">AI Prob</th><th className="p-2">Status</th></tr></thead>
                  <tbody>
                    {(accountGroups.get(selectedAccount) || []).map((r) => (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="p-2 font-semibold">{r.requisition}</td>
                        <td className="p-2">{r.month}</td>
                        <td className="p-2 text-center font-bold">{r.newPositions}</td>
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
            </Card>
          )}
        </>
      )}

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
                { label: 'At Risk', val: filtered.filter((r) => r.risk === 'high').reduce((s, r) => s + r.newPositions, 0), color: '#ef4444', conf: 85 },
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
                <thead><tr className="border-b-2 border-slate-100"><th className="text-left p-2 text-slate-400 font-bold uppercase text-[10px]">Account</th><th className="p-2">Requisition</th><th className="p-2">Stage</th><th className="p-2">Ageing</th><th className="p-2">Prob</th><th className="p-2">Risk</th><th className="p-2">Recommendation</th></tr></thead>
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
    </>
  );
}
