/**
 * Client Contacts tab for a single account.
 *
 * Self-contained: owns its own data layer (direct supabase calls + realtime
 * subscription) so it doesn't depend on edits to useAccountStore that other
 * passes keep reverting.
 *
 * Schema: account_client_contacts (id, account_id, name, email, phone,
 * last_contact_at, gift, gift_date, notes, created_at, updated_at, updated_by).
 *
 * UX:
 *   - Table of contacts for the given accountId.
 *   - Inline-edit every column; save on blur.
 *   - "+ Add contact" appends a blank row; row commits on first blur.
 *   - Trash icon deletes the row.
 */
import { Fragment, useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2, Gift, Mail, Phone, Calendar, Briefcase, StickyNote, ChevronDown, ChevronRight } from 'lucide-react';
import { nanoid } from 'nanoid';
import { supabase, CLIENT_ID } from '../../lib/supabase';
import type { AccountClientContact, ClientContactRelationship } from '../../types/clientContact';
import {
  CLIENT_CONTACT_RELATIONSHIPS,
  CLIENT_CONTACT_RELATIONSHIP_STYLES,
} from '../../types/clientContact';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToContact(row: any): AccountClientContact {
  const rel = row.relationship;
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name ?? '',
    title: row.title ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    relationship: rel === 'hot' || rel === 'warm' || rel === 'cold' ? rel : null,
    lastContactAt: row.last_contact_at ?? null,
    gift: row.gift ?? '',
    giftDate: row.gift_date ?? null,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function contactToRow(c: AccountClientContact) {
  return {
    id: c.id,
    account_id: c.accountId,
    name: c.name,
    title: c.title || null,
    email: c.email || null,
    phone: c.phone || null,
    relationship: c.relationship ?? null,
    last_contact_at: c.lastContactAt || null,
    gift: c.gift || null,
    gift_date: c.giftDate || null,
    notes: c.notes || '',
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

export function ClientContactsTab({ accountId }: { accountId: string }) {
  const [contacts, setContacts] = useState<AccountClientContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const toggleNotes = (id: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('account_client_contacts')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setContacts((data ?? []).map(rowToContact));
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime — refetch whenever any contact for this account changes
  useEffect(() => {
    const channel = supabase
      .channel(`client-contacts-${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'account_client_contacts', filter: `account_id=eq.${accountId}` },
        () => { void refresh(); },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [accountId, refresh]);

  const flashSaving = (id: string, on: boolean) => {
    setSavingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const saveContact = async (c: AccountClientContact) => {
    flashSaving(c.id, true);
    const { error: e } = await supabase
      .from('account_client_contacts')
      .upsert(contactToRow(c), { onConflict: 'id' });
    flashSaving(c.id, false);
    if (e) setError(e.message);
  };

  const patchLocal = (id: string, patch: Partial<AccountClientContact>) => {
    setContacts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addBlank = () => {
    const now = new Date().toISOString();
    const c: AccountClientContact = {
      id: nanoid(),
      accountId,
      name: '',
      title: '',
      email: '',
      phone: '',
      relationship: null,
      lastContactAt: null,
      gift: '',
      giftDate: null,
      notes: '',
      createdAt: now,
      updatedAt: now,
    };
    setContacts((rows) => [...rows, c]);
  };

  const removeContact = async (id: string) => {
    setContacts((rows) => rows.filter((r) => r.id !== id));
    const { error: e } = await supabase
      .from('account_client_contacts')
      .delete()
      .eq('id', id);
    if (e) setError(e.message);
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading contacts…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          People at this client we keep in touch with. Track last call + gifts so we never go cold.
        </div>
        <button
          type="button"
          onClick={addBlank}
          className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1"
        >
          <Plus size={12} /> Add contact
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
          No client contacts yet. Click <strong>+ Add contact</strong> to add the first one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm [&_td]:align-middle [&_th]:align-middle">
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-semibold w-6"></th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1"><Briefcase size={10} /> Title</span>
                </th>
                <th className="px-3 py-2 font-semibold">Relationship</th>
                <th className="px-3 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1"><Mail size={10} /> Email</span>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1"><Phone size={10} /> Phone</span>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1"><Calendar size={10} /> Last contact</span>
                </th>
                <th className="px-3 py-2 font-semibold">
                  <span className="inline-flex items-center gap-1"><Gift size={10} /> Gift</span>
                </th>
                <th className="px-3 py-2 font-semibold">Gift date</th>
                <th className="px-3 py-2 font-semibold w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.map((c) => {
                const saving = savingIds.has(c.id);
                const blur = () => { if (c.name.trim()) void saveContact(c); };
                const isNotesOpen = expandedNotes.has(c.id);
                const hasNotes = !!c.notes && c.notes.trim().length > 0;
                return (
                  <Fragment key={c.id}>
                    <tr className="hover:bg-slate-50/60">
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleNotes(c.id)}
                          className={`p-1 rounded ${hasNotes ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-600'}`}
                          title={isNotesOpen ? 'Hide notes' : (hasNotes ? 'Show notes' : 'Add notes')}
                        >
                          {isNotesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={c.name}
                          onChange={(e) => patchLocal(c.id, { name: e.target.value })}
                          onBlur={blur}
                          placeholder="Name *"
                          className="w-full h-7 px-2 text-xs leading-tight border border-transparent rounded hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={c.title}
                          onChange={(e) => patchLocal(c.id, { title: e.target.value })}
                          onBlur={blur}
                          placeholder="VP Engineering"
                          className="w-full h-7 px-2 text-xs leading-tight border border-transparent rounded hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <RelationshipPicker
                          value={c.relationship}
                          onChange={(rel) => { patchLocal(c.id, { relationship: rel }); if (c.name.trim()) void saveContact({ ...c, relationship: rel }); }}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="email"
                          value={c.email}
                          onChange={(e) => patchLocal(c.id, { email: e.target.value })}
                          onBlur={blur}
                          placeholder="email@client.com"
                          className="w-full h-7 px-2 text-xs leading-tight border border-transparent rounded hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={c.phone}
                          onChange={(e) => patchLocal(c.id, { phone: e.target.value })}
                          onBlur={blur}
                          placeholder="+91 …"
                          className="w-full h-7 px-2 text-xs leading-tight border border-transparent rounded hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={c.lastContactAt ?? ''}
                          onChange={(e) => patchLocal(c.id, { lastContactAt: e.target.value || null })}
                          onBlur={blur}
                          className="w-[130px] h-7 px-2 text-xs leading-tight border border-slate-200 rounded bg-white hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={c.gift}
                          onChange={(e) => patchLocal(c.id, { gift: e.target.value })}
                          onBlur={blur}
                          placeholder="Diwali hamper, etc."
                          className="w-full h-7 px-2 text-xs leading-tight border border-transparent rounded hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={c.giftDate ?? ''}
                          onChange={(e) => patchLocal(c.id, { giftDate: e.target.value || null })}
                          onBlur={blur}
                          className="w-[130px] h-7 px-2 text-xs leading-tight border border-slate-200 rounded bg-white hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {saving ? (
                          <Loader2 size={12} className="animate-spin text-slate-400 inline" />
                        ) : (
                          <button
                            type="button"
                            onClick={() => { if (confirm(`Remove ${c.name || 'this contact'}?`)) void removeContact(c.id); }}
                            className="text-slate-300 hover:text-red-600 p-1 rounded hover:bg-red-50"
                            title="Remove contact"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {isNotesOpen && (
                      <tr className="bg-amber-50/30">
                        <td></td>
                        <td colSpan={9} className="px-3 py-2">
                          <label className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 flex items-center gap-1 mb-1">
                            <StickyNote size={11} className="text-amber-500" /> Notes
                          </label>
                          <textarea
                            value={c.notes}
                            onChange={(e) => patchLocal(c.id, { notes: e.target.value })}
                            onBlur={blur}
                            placeholder="Anything worth remembering — preferences, family details, history, internal notes…"
                            rows={3}
                            className="w-full text-xs leading-relaxed px-2 py-1.5 border border-slate-200 rounded bg-white focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Colored pill that doubles as a select. Click → opens the native picker. */
function RelationshipPicker({
  value,
  onChange,
}: {
  value: ClientContactRelationship | null;
  onChange: (next: ClientContactRelationship | null) => void;
}) {
  const style = value ? CLIENT_CONTACT_RELATIONSHIP_STYLES[value] : null;
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value || null) as ClientContactRelationship | null)}
        className={
          'h-7 pl-2.5 pr-7 text-[11px] font-semibold uppercase tracking-wider rounded-full border appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
          (style ? `${style.bg} ${style.text} ${style.border}` : 'bg-slate-50 text-slate-400 border-slate-200')
        }
      >
        <option value="">— Set —</option>
        {CLIENT_CONTACT_RELATIONSHIPS.map((r) => (
          <option key={r} value={r}>{CLIENT_CONTACT_RELATIONSHIP_STYLES[r].label}</option>
        ))}
      </select>
      <ChevronDown size={11} className={`absolute right-2 pointer-events-none ${style ? style.text : 'text-slate-400'}`} />
    </div>
  );
}
