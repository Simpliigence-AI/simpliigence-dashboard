import { useForecastStore, useFinancialStore } from '../store';
import { Button, Card } from '../components/ui';
import { PageHeader } from '../components/shared/PageHeader';
import { Download, Trash2, FileSpreadsheet, Check, Brain, ShieldCheck, Upload, Clock, FolderOpen, FolderCheck, FolderX } from 'lucide-react';
import { loadSeedIntoStores } from '../data/employeeSeed';
import { useState, useRef, useEffect } from 'react';
import { ConfirmDialog } from '../components/ui';
import { deriveEmployeeSummaries, deriveProjectSummaries } from '../lib/parseSpreadsheet';
import { db } from '../lib/supabaseSync';
import { getClaudeApiKey, setClaudeApiKey } from '../lib/claudeQuery';
import {
  downloadBackup,
  restoreFromBackup,
  getLastBackupTime,
  getBackupFolderState,
  pickBackupFolder,
  clearBackupFolder,
  reauthorizeBackupFolder,
  isFolderBackupSupported,
  type BackupFolderState,
} from '../lib/backup';

export default function SettingsPage() {
  const forecastStore = useForecastStore();
  const financialStore = useFinancialStore();
  const { settings, updateSettings } = financialStore;
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [claudeKey, setClaudeKey] = useState(getClaudeApiKey());
  const [keyVisible, setKeyVisible] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastBackup = getLastBackupTime();
  const [folderState, setFolderState] = useState<BackupFolderState>({
    supported: isFolderBackupSupported(),
    name: null,
    permission: 'unknown',
  });

  useEffect(() => {
    let mounted = true;
    getBackupFolderState().then((s) => {
      if (mounted) setFolderState(s);
    });
    return () => { mounted = false; };
  }, []);

  const refreshFolderState = async () => {
    const s = await getBackupFolderState();
    setFolderState(s);
  };

  const employees = deriveEmployeeSummaries(forecastStore.assignments);
  const projects = deriveProjectSummaries(forecastStore.assignments);

  const exportData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      version: 3,
      assignments: forecastStore.assignments,
      financial: { settings },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simpliigence-export-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = async () => {
    // Clear Supabase
    await db.clearAll();
    // Clear localStorage
    localStorage.removeItem('simpliigence-forecast');
    localStorage.removeItem('simpliigence-financial');
    localStorage.removeItem('simpliigence-sync');
    localStorage.removeItem('simpliigence-hiring-forecast');
    localStorage.removeItem('simpliigence-pipeline');
    localStorage.removeItem('simpliigence-staffing');
    localStorage.removeItem('simpliigence-us-staffing');
    window.location.reload();
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage data sync and configuration." />

      <div className="max-w-3xl space-y-6">
        <Card title="Data Overview">
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-slate-50">
              <span className="text-sm text-slate-600">Forecast Assignments</span>
              <span className="text-sm font-semibold text-slate-800">{forecastStore.assignments.length}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-slate-50">
              <span className="text-sm text-slate-600">Unique Employees</span>
              <span className="text-sm font-semibold text-slate-800">{employees.length}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-slate-600">Active Projects</span>
              <span className="text-sm font-semibold text-slate-800">{projects.length}</span>
            </div>
          </div>
        </Card>

        <Card title="Currency & Exchange Rates">
          <p className="text-xs text-slate-400 mb-4">Set conversion rates used across the dashboard for cost and revenue calculations.</p>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">USD to INR (₹ per $1 USD)</label>
                <input
                  type="number"
                  step="0.1"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={settings.exchangeRate}
                  onChange={(e) => updateSettings({ exchangeRate: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="text-sm text-slate-500 pt-6">
                $1 USD = ₹{settings.exchangeRate.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 mb-1">CAD to USD ($ per CA$1)</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={settings.cadToUsdRate}
                  onChange={(e) => updateSettings({ cadToUsdRate: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="text-sm text-slate-500 pt-6">
                CA$1 = ${settings.cadToUsdRate.toFixed(2)} USD
              </div>
            </div>
            <div className="border-t border-slate-100 pt-3 text-xs text-slate-400">
              <p>Quick reference: CA$100,000 = ${Math.round(100000 * (settings.cadToUsdRate || 0.73)).toLocaleString()} USD = ₹{Math.round(100000 * (settings.cadToUsdRate || 0.73) * (settings.exchangeRate || 83.5)).toLocaleString()} INR</p>
            </div>
          </div>
        </Card>

        <Card title="AI Smart Query">
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Brain size={16} className="text-blue-600" />
              <p className="text-sm text-slate-600">Power the Dashboard Smart Query with Claude AI for accurate, natural-language answers.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Anthropic API Key</label>
              <p className="text-xs text-slate-400 mb-2">Stored locally in your browser only — never sent to Supabase or any server except Anthropic.</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={keyVisible ? 'text' : 'password'}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                    placeholder="sk-ant-..."
                    value={claudeKey}
                    onChange={(e) => setClaudeKey(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setKeyVisible(!keyVisible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                  >
                    {keyVisible ? 'Hide' : 'Show'}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setClaudeApiKey(claudeKey);
                  }}
                >
                  Save
                </Button>
                {getClaudeApiKey() && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setClaudeApiKey('');
                      setClaudeKey('');
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
              {getClaudeApiKey() && (
                <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1">
                  <Check size={12} /> API key configured — Smart Query is AI-powered.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Backup & Restore">
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-emerald-600" />
              <p className="text-sm text-slate-600">Automatic daily backups run silently. You can also download or restore manually.</p>
            </div>
            {lastBackup && (
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                <Clock size={14} />
                Last backup: {new Date(lastBackup).toLocaleString()}
              </div>
            )}

            {/* Backup folder picker */}
            <div className="rounded-lg border border-slate-200 px-3 py-3 bg-slate-50/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {folderState.name && folderState.permission === 'granted' ? (
                      <FolderCheck size={16} className="text-emerald-600 shrink-0" />
                    ) : folderState.name ? (
                      <FolderX size={16} className="text-amber-600 shrink-0" />
                    ) : (
                      <FolderOpen size={16} className="text-slate-400 shrink-0" />
                    )}
                    <p className="text-sm font-medium text-slate-800">Local backup folder</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {!folderState.supported ? (
                      <>Folder backups require Chrome, Edge, or Brave. Other browsers will save to Downloads only.</>
                    ) : folderState.name && folderState.permission === 'granted' ? (
                      <>
                        Saving to <span className="font-medium text-slate-700">"{folderState.name}"</span>.
                        Daily auto-backups and "Backup Now" will write here.
                      </>
                    ) : folderState.name ? (
                      <>
                        Folder <span className="font-medium text-slate-700">"{folderState.name}"</span> is set
                        but permission expired. Click <em>Re-authorize</em> to reconnect.
                      </>
                    ) : (
                      <>
                        Pick a folder (e.g. inside Dropbox) and backups will save there automatically.
                        Tip: <code>~/Dropbox/simpliigence-dashboard/backups</code> auto-syncs off-site.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {folderState.supported && folderState.name && folderState.permission !== 'granted' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const r = await reauthorizeBackupFolder();
                        await refreshFolderState();
                        setBackupStatus(r.ok ? 'Folder reconnected.' : `Re-authorize failed: ${r.error ?? ''}`);
                        setTimeout(() => setBackupStatus(null), 4000);
                      }}
                    >
                      Re-authorize
                    </Button>
                  )}
                  {folderState.supported && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const r = await pickBackupFolder();
                        await refreshFolderState();
                        if (r.ok) {
                          setBackupStatus(`Backup folder set: "${r.name}"`);
                        } else if (r.error && r.error !== 'Cancelled') {
                          setBackupStatus(`Could not set folder: ${r.error}`);
                        }
                        setTimeout(() => setBackupStatus(null), 4000);
                      }}
                    >
                      <FolderOpen size={14} /> {folderState.name ? 'Change' : 'Choose folder'}
                    </Button>
                  )}
                  {folderState.supported && folderState.name && (
                    <button
                      onClick={async () => {
                        await clearBackupFolder();
                        await refreshFolderState();
                        setBackupStatus('Backup folder cleared.');
                        setTimeout(() => setBackupStatus(null), 3000);
                      }}
                      className="text-xs text-slate-400 hover:text-red-500 px-1"
                      title="Forget this folder"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">Download Full Backup</p>
                <p className="text-xs text-slate-500">Exports all Supabase tables as a JSON file.</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  setBackupStatus('Backing up...');
                  const result = await downloadBackup();
                  if (result.ok) {
                    setBackupStatus(
                      result.folder
                        ? `Backup saved to "${result.folder}" and Downloads.`
                        : 'Backup downloaded!',
                    );
                  } else {
                    setBackupStatus('Backup failed');
                  }
                  setTimeout(() => setBackupStatus(null), 4000);
                  refreshFolderState();
                }}
              >
                <Download size={14} /> Backup Now
              </Button>
            </div>
            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">Restore from Backup</p>
                <p className="text-xs text-slate-500">Upload a previously downloaded backup file to restore data.</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setRestoreFile(file);
                      setConfirmRestore(true);
                    }
                  }}
                />
                <Button size="sm" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} /> Restore
                </Button>
              </div>
            </div>
            {backupStatus && (
              <p className={`text-xs font-medium ${backupStatus.includes('failed') ? 'text-red-600' : 'text-emerald-600'}`}>
                {backupStatus}
              </p>
            )}
          </div>
        </Card>

        <Card title="Data Management">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">Load Seed Data</p>
                <p className="text-xs text-slate-500">Import sample employee forecast data. Replaces current data.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setConfirmSeed(true)}>
                <FileSpreadsheet size={14} /> Load Data
              </Button>
            </div>
            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">Export All Data</p>
                <p className="text-xs text-slate-500">Download as JSON. {forecastStore.assignments.length} assignments.</p>
              </div>
              <Button size="sm" variant="secondary" onClick={exportData}>
                <Download size={14} /> Export
              </Button>
            </div>
            <div className="border-t border-slate-100 pt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-red-700">Clear All Data</p>
                <p className="text-xs text-slate-500">Permanently delete everything. Cannot be undone.</p>
              </div>
              <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
                <Trash2 size={14} /> Clear
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear All Data?"
        message="This will delete all forecast data and settings. Export first if needed."
        confirmLabel="Clear Everything"
        onConfirm={clearAll}
        onCancel={() => setConfirmClear(false)}
      />

      <ConfirmDialog
        open={confirmSeed}
        title="Load Seed Data?"
        message="This will replace all current data with sample forecast data from the master spreadsheet."
        confirmLabel="Load Data"
        onConfirm={() => { setConfirmSeed(false); loadSeedIntoStores(); }}
        onCancel={() => setConfirmSeed(false)}
      />

      <ConfirmDialog
        open={confirmRestore}
        title="Restore from Backup?"
        message={`This will replace ALL current data with the backup file "${restoreFile?.name}". This cannot be undone. Download a backup first if needed.`}
        confirmLabel="Restore"
        onConfirm={async () => {
          setConfirmRestore(false);
          if (!restoreFile) return;
          setBackupStatus('Restoring...');
          const result = await restoreFromBackup(restoreFile);
          if (result.success) {
            setBackupStatus('Restore complete! Reloading...');
            setTimeout(() => window.location.reload(), 1500);
          } else {
            setBackupStatus(`Restore failed: ${result.error}`);
            setTimeout(() => setBackupStatus(null), 5000);
          }
          setRestoreFile(null);
        }}
        onCancel={() => { setConfirmRestore(false); setRestoreFile(null); }}
      />
    </div>
  );
}
