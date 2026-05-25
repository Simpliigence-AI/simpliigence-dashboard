/**
 * Backup utility — exports all Supabase tables to a downloadable JSON file.
 *
 * Two destinations:
 *   1. A user-chosen local folder (via the File System Access API) — survives
 *      browser cache clears and, if placed inside a Dropbox/iCloud folder,
 *      becomes an automatic off-site backup. Persistent across sessions via
 *      an IndexedDB-stored FileSystemDirectoryHandle.
 *   2. localStorage — fallback for the daily silent backup and for browsers
 *      that don't support the File System Access API (Safari, Firefox).
 *
 * Manual "Backup Now" always also triggers a regular browser download as a
 * belt-and-braces safety net.
 */
import { supabase } from './supabase';

const BACKUP_TIMESTAMP_KEY = 'simpliigence-last-backup';
const BACKUP_DATA_KEY = 'simpliigence-backup-data';
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const TABLES = [
  'forecast_assignments',
  'forecast_meta',
  'financial_settings',
  'sync_config',
  'hiring_forecast_config',
  'staffing_requests',
  'pipeline_projects',
  'india_staffing_accounts',
  'india_staffing_requisitions',
  'india_staffing_statuses',
  'india_staffing_candidates',
  'india_staffing_history',
  'us_staffing_accounts',
  'us_staffing_requisitions',
  // Added 2026-04-29 after Open Bench data loss incident — these tables
  // MUST be backed up so a localStorage clear can never silently lose
  // real roster data again.
  'open_bench_resources',
  'open_bench_updates',
  'india_roster',
  'us_roster',
  'authorized_users',
  'actual_hours',
] as const;

export interface BackupPayload {
  version: 1;
  timestamp: string;
  tables: Record<string, unknown[]>;
}

/* ─── IndexedDB persistence of the chosen directory handle ───────── */

const IDB_DB = 'simpliigence-backups';
const IDB_STORE = 'handles';
const IDB_KEY = 'backup-dir';

function openIDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function saveHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function deleteHandle(): Promise<void> {
  const db = await openIDB();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onabort = () => resolve();
    tx.onerror = () => resolve();
  });
}

/* ─── File System Access API helpers ─────────────────────────────── */

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
}

export function isFolderBackupSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function queryPerm(handle: FileSystemDirectoryHandle): Promise<PermissionState | 'denied'> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (!h.queryPermission) return 'granted'; // older API behaviour: assume granted once picked
    return await h.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

async function requestPerm(handle: FileSystemDirectoryHandle): Promise<PermissionState | 'denied'> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
    };
    if (!h.requestPermission) return 'granted';
    return await h.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** Already-granted readwrite access? Safe to call without a user gesture. */
async function hasWriteAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await queryPerm(handle)) === 'granted';
}

/** Try to obtain readwrite access. May prompt the user — requires a user gesture. */
async function ensureWriteAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasWriteAccess(handle)) return true;
  return (await requestPerm(handle)) === 'granted';
}

async function writeBackupToFolder(
  handle: FileSystemDirectoryHandle,
  filename: string,
  payload: BackupPayload,
): Promise<boolean> {
  try {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    console.log('[backup] Wrote', filename, 'to folder', handle.name);
    return true;
  } catch (e) {
    console.warn('[backup] writeBackupToFolder failed:', e);
    return false;
  }
}

/* ─── Public folder-management API used by Settings ─────────────── */

export interface BackupFolderState {
  supported: boolean;
  name: string | null;
  permission: 'granted' | 'prompt' | 'denied' | 'unknown';
}

export async function getBackupFolderState(): Promise<BackupFolderState> {
  const supported = isFolderBackupSupported();
  if (!supported) return { supported: false, name: null, permission: 'unknown' };
  const handle = await loadHandle();
  if (!handle) return { supported: true, name: null, permission: 'unknown' };
  const perm = await queryPerm(handle);
  return {
    supported: true,
    name: handle.name,
    permission: perm === 'granted' ? 'granted' : perm === 'prompt' ? 'prompt' : 'denied',
  };
}

export async function pickBackupFolder(): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!isFolderBackupSupported()) {
    return { ok: false, error: 'This browser does not support folder backups. Try Chrome, Edge, or Brave.' };
  }
  try {
    const w = window as DirectoryPickerWindow;
    if (!w.showDirectoryPicker) return { ok: false, error: 'showDirectoryPicker unavailable' };
    const handle = await w.showDirectoryPicker({ mode: 'readwrite' });
    if (!(await ensureWriteAccess(handle))) {
      return { ok: false, error: 'Permission to write was denied.' };
    }
    await saveHandle(handle);
    return { ok: true, name: handle.name };
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return { ok: false, error: 'Cancelled' };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function clearBackupFolder(): Promise<void> {
  await deleteHandle();
}

/** Re-prompt for permission on a previously-chosen folder. Needs a user gesture. */
export async function reauthorizeBackupFolder(): Promise<{ ok: boolean; error?: string }> {
  const handle = await loadHandle();
  if (!handle) return { ok: false, error: 'No backup folder set. Choose one first.' };
  const ok = await ensureWriteAccess(handle);
  return ok ? { ok: true } : { ok: false, error: 'Permission denied' };
}

/* ─── Fetch all Supabase tables ──────────────────────────────────── */

async function fetchAllData(): Promise<BackupPayload | null> {
  const tables: Record<string, unknown[]> = {};
  let hasError = false;

  const results = await Promise.all(
    TABLES.map(async (table) => {
      const { data, error } = await supabase.from(table).select('*');
      if (error) {
        console.warn(`[backup] Failed to fetch ${table}:`, error.message);
        hasError = true;
        return { table, data: [] };
      }
      return { table, data: data || [] };
    }),
  );

  if (hasError) return null;

  for (const { table, data } of results) {
    tables[table] = data;
  }

  return {
    version: 1,
    timestamp: new Date().toISOString(),
    tables,
  };
}

function makeFilename(date = new Date()): string {
  return `simpliigence-backup-${date.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
}

/* ─── Public backup actions ──────────────────────────────────────── */

/** Manual backup: writes to the chosen folder if available AND triggers a
 *  browser download. Updates the last-backup timestamp. */
export async function downloadBackup(): Promise<{ ok: boolean; folder?: string }> {
  const payload = await fetchAllData();
  if (!payload) return { ok: false };

  const filename = makeFilename();
  const json = JSON.stringify(payload, null, 2);

  let folderName: string | undefined;
  const handle = await loadHandle();
  if (handle && (await ensureWriteAccess(handle))) {
    const wrote = await writeBackupToFolder(handle, filename, payload);
    if (wrote) folderName = handle.name;
  }

  // Always also offer a download — the user explicitly asked for a backup.
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  try {
    localStorage.setItem(BACKUP_TIMESTAMP_KEY, new Date().toISOString());
    localStorage.setItem(BACKUP_DATA_KEY, json);
  } catch { /* localStorage full — ok, file was already downloaded */ }

  return { ok: true, folder: folderName };
}

/** Silent daily backup: writes to chosen folder if permission is already
 *  granted (no prompt possible without a user gesture), plus localStorage. */
export async function silentBackup(): Promise<boolean> {
  const payload = await fetchAllData();
  if (!payload) return false;

  const filename = makeFilename();
  const json = JSON.stringify(payload, null, 2);

  const handle = await loadHandle();
  if (handle && (await hasWriteAccess(handle))) {
    await writeBackupToFolder(handle, filename, payload);
  }

  try {
    localStorage.setItem(BACKUP_TIMESTAMP_KEY, new Date().toISOString());
    localStorage.setItem(BACKUP_DATA_KEY, json);
    console.log('[backup] Silent backup saved at', payload.timestamp);
    return true;
  } catch {
    console.warn('[backup] localStorage full, could not save silent backup');
    return false;
  }
}

/** Run a silent backup if more than 24 hours since last backup. */
export async function autoBackupIfNeeded(): Promise<void> {
  try {
    const last = localStorage.getItem(BACKUP_TIMESTAMP_KEY);
    if (last) {
      const elapsed = Date.now() - new Date(last).getTime();
      if (elapsed < BACKUP_INTERVAL_MS) {
        console.log('[backup] Last backup was', Math.round(elapsed / 3600000), 'hours ago — skipping');
        return;
      }
    }
    console.log('[backup] Running automatic daily backup...');
    await silentBackup();
  } catch {
    console.warn('[backup] Auto-backup check failed');
  }
}

export function getLastBackupTime(): string | null {
  try {
    return localStorage.getItem(BACKUP_TIMESTAMP_KEY);
  } catch {
    return null;
  }
}

/* ─── Restore ────────────────────────────────────────────────────── */

export async function restoreFromBackup(file: File): Promise<{ success: boolean; error?: string }> {
  try {
    const text = await file.text();
    const payload: BackupPayload = JSON.parse(text);

    if (payload.version !== 1 || !payload.tables) {
      return { success: false, error: 'Invalid backup file format' };
    }

    for (const table of TABLES) {
      const rows = payload.tables[table];
      if (!rows || rows.length === 0) continue;

      const { error: delError } = await supabase.from(table).delete().neq('id', '');
      if (delError) {
        console.warn(`[restore] Failed to clear ${table}:`, delError.message);
      }

      const { error } = await supabase.from(table).insert(rows);
      if (error) {
        console.warn(`[restore] Failed to restore ${table}:`, error.message);
        return { success: false, error: `Failed to restore ${table}: ${error.message}` };
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: `Parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
