/**
 * Vendor Zustand store — vendor records + their outreach log.
 * Hydrated from Supabase on app init; realtime subscription refreshes the
 * whole bundle on any change.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type { Vendor, VendorOutreach, VendorOutreachStatus } from '../types/vendor';

interface VendorState {
  vendors: Vendor[];
  outreach: VendorOutreach[];

  setAll: (data: { vendors: Vendor[]; outreach: VendorOutreach[] }) => void;

  addVendor: (params: {
    companyName: string;
    spocName?: string;
    spocEmail?: string;
    altEmails?: string[];
    skills?: string[];
    notes?: string;
  }) => Promise<Vendor>;
  updateVendor: (id: string, patch: Partial<Vendor>) => Promise<void>;
  removeVendor: (id: string) => Promise<void>;

  /** Log a "Send to vendor" event. */
  logOutreach: (params: {
    vendorId: string;
    requisitionId: string;
    sentBy?: string;
    subject?: string;
    bodyPreview?: string;
    sendStatus?: VendorOutreachStatus;
  }) => Promise<VendorOutreach>;

  /** Manually flip an existing outreach row's status — used by the recruiter
   *  to close the loop without a Resend webhook (mark replied / bounced). */
  setOutreachStatus: (id: string, status: VendorOutreachStatus) => Promise<void>;
}

export const useVendorStore = create<VendorState>()(
  persist(
    (set, get) => ({
      vendors: [],
      outreach: [],

      setAll: ({ vendors, outreach }) => set({ vendors, outreach }),

      addVendor: async ({ companyName, spocName, spocEmail, altEmails, skills, notes }) => {
        const now = new Date().toISOString();
        const v: Vendor = {
          id: nanoid(),
          companyName: companyName.trim(),
          spocName: spocName?.trim() || null,
          spocEmail: spocEmail?.trim().toLowerCase() || null,
          altEmails: altEmails ?? [],
          skills: skills ?? [],
          notes: notes ?? '',
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        set({ vendors: [...get().vendors, v] });
        await db.upsertVendor(v);
        return v;
      },

      updateVendor: async (id, patch) => {
        const cur = get().vendors.find((v) => v.id === id);
        if (!cur) return;
        const next: Vendor = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        set({ vendors: get().vendors.map((v) => (v.id === id ? next : v)) });
        await db.upsertVendor(next);
      },

      removeVendor: async (id) => {
        set({
          vendors: get().vendors.filter((v) => v.id !== id),
          outreach: get().outreach.filter((o) => o.vendorId !== id),
        });
        await db.deleteVendor(id);
      },

      logOutreach: async ({ vendorId, requisitionId, sentBy, subject, bodyPreview, sendStatus }) => {
        const o: VendorOutreach = {
          id: nanoid(),
          vendorId,
          requisitionId,
          sentAt: new Date().toISOString(),
          sentBy: sentBy?.toLowerCase() ?? null,
          subject: subject ?? '',
          bodyPreview: (bodyPreview ?? '').slice(0, 500),
          sendStatus: sendStatus ?? 'composed',
          sendError: null,
        };
        set({ outreach: [o, ...get().outreach] });
        await db.upsertVendorOutreach(o);
        return o;
      },

      setOutreachStatus: async (id, status) => {
        const cur = get().outreach.find((o) => o.id === id);
        if (!cur) return;
        const next: VendorOutreach = { ...cur, sendStatus: status };
        set({ outreach: get().outreach.map((o) => (o.id === id ? next : o)) });
        await db.upsertVendorOutreach(next);
      },
    }),
    {
      name: 'simpliigence-vendors',
      version: 1,
    },
  ),
);
