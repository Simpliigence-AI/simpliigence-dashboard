/**
 * Timesheet documents Zustand store.
 *
 * Per-week client-approved timesheet attachments. Mirrors useAccountDocsStore
 * (upload → Storage → metadata row → list) but scoped to the current user's
 * week rather than an account, and without the AI-processing pipeline.
 *
 * Not persisted — always reflects server truth. Files live in the private
 * Supabase Storage bucket 'timesheet-documents' and download via signed URLs.
 */
import { create } from 'zustand';
import { db } from '../lib/supabaseSync';
import type { TimesheetDocument } from '../types/timeEntry';

/** Cache key: one bucket of docs per (employee, week). */
function key(employeeEmail: string, periodStart: string): string {
  return `${employeeEmail.trim().toLowerCase()}::${periodStart}`;
}

// Accepted upload types: PDF, common images, Word, Excel/CSV.
const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'csv'];
const MB = 1024 * 1024;
const MAX_MB = 15;

interface State {
  docsByWeek: Record<string, TimesheetDocument[]>;
  loadingByWeek: Record<string, boolean>;

  loadForWeek: (employeeEmail: string, periodStart: string) => Promise<void>;
  upload: (params: {
    employeeEmail: string;
    periodStart: string;
    periodEnd: string;
    file: File;
    uploadedBy?: string | null;
  }) => Promise<TimesheetDocument>;
  remove: (employeeEmail: string, periodStart: string, doc: TimesheetDocument) => Promise<void>;
  signedUrl: (storagePath: string) => Promise<string | null>;
}

export const useTimesheetDocsStore = create<State>((set) => ({
  docsByWeek: {},
  loadingByWeek: {},

  loadForWeek: async (employeeEmail, periodStart) => {
    const k = key(employeeEmail, periodStart);
    set((s) => ({ loadingByWeek: { ...s.loadingByWeek, [k]: true } }));
    try {
      const docs = await db.listTimesheetDocuments(employeeEmail, periodStart);
      set((s) => ({ docsByWeek: { ...s.docsByWeek, [k]: docs } }));
    } finally {
      set((s) => ({ loadingByWeek: { ...s.loadingByWeek, [k]: false } }));
    }
  },

  upload: async ({ employeeEmail, periodStart, periodEnd, file, uploadedBy }) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      throw new Error(`Unsupported file type ".${ext}". Allowed: PDF, images (PNG/JPG/GIF/WebP), Word (DOC/DOCX), Excel (XLS/XLSX/CSV).`);
    }
    if (file.size > MAX_MB * MB) {
      throw new Error(`File too large: ${(file.size / MB).toFixed(1)} MB (limit ${MAX_MB} MB).`);
    }
    const doc = await db.uploadTimesheetDocument({ employeeEmail, periodStart, periodEnd, file, uploadedBy });
    const k = key(employeeEmail, periodStart);
    set((s) => ({ docsByWeek: { ...s.docsByWeek, [k]: [doc, ...(s.docsByWeek[k] ?? [])] } }));
    return doc;
  },

  remove: async (employeeEmail, periodStart, doc) => {
    await db.deleteTimesheetDocument(doc.id, doc.storagePath);
    const k = key(employeeEmail, periodStart);
    set((s) => ({ docsByWeek: { ...s.docsByWeek, [k]: (s.docsByWeek[k] ?? []).filter((d) => d.id !== doc.id) } }));
  },

  signedUrl: async (storagePath) => db.signedTimesheetDocumentUrl(storagePath),
}));

/** Selector helper matching the store's cache key scheme. */
export function timesheetDocsKey(employeeEmail: string, periodStart: string): string {
  return key(employeeEmail, periodStart);
}
