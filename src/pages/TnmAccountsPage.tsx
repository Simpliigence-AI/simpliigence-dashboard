/**
 * TNM Accounts — Global T&M > TNM Accounts.
 *
 * Scannable tile grid: Active + Inactive + Prospect accounts on one canvas.
 * Filter chips (with counts) let the user toggle each status independently;
 * all three are on by default. Click a tile to open the detail drawer,
 * which is where the full inline editing + contacts CRUD lives.
 *
 * Order within the grid: Active first, then Prospect, then Inactive.
 * Alphabetical inside each status.
 */
import { useMemo, useState } from 'react';
import {
  Plus, Trash2, ArrowRightCircle, UserPlus, Rocket, Check,
  Building2, MapPin, User, Users, Search,
} from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Drawer, Input, Select, Textarea, EmptyState } from '../components/ui';
import { useTnmAccountsStore } from '../store/useTnmAccountsStore';
import {
  TNM_ENTITY_OPTIONS, TNM_WORK_TYPE_OPTIONS, TNM_REGION_OPTIONS,
} from '../types/tnmAccount';
import type { TnmAccount, TnmAccountContact, TnmEntity, TnmWorkType, TnmRegion, TnmStatus } from '../types/tnmAccount';

// Sort ordering: active accounts rank first (they're the live ones),
// then prospects (things salespeople are working), then inactive (archive).
const STATUS_RANK: Record<TnmStatus, number> = { active: 0, prospect: 1, inactive: 2 };

export default function TnmAccountsPage() {
  const {
    accounts, contacts,
    addAccount, updateAccount, removeAccount, setStatus, promoteToGlobalDemand,
    addContact, updateContact, removeContact,
  } = useTnmAccountsStore();

  // Which status buckets are visible. Multi-select — default all on.
  const [statusOn, setStatusOn] = useState<Record<TnmStatus, boolean>>({
    active: true, prospect: true, inactive: true,
  });
  const [q, setQ] = useState('');
  const [entityFilter, setEntityFilter] = useState<TnmEntity | ''>('');
  const [regionFilter, setRegionFilter] = useState<TnmRegion | ''>('');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [newName, setNewName] = useState('');
  const [newEntity, setNewEntity] = useState<TnmEntity>('SI');
  const [newRegion, setNewRegion] = useState<TnmRegion>('USA');
  const [newWorkType, setNewWorkType] = useState<TnmWorkType | ''>('');
  const [newStatus, setNewStatus] = useState<TnmStatus>('active');
  const [newKeyContact, setNewKeyContact] = useState('');
  const [newConsultant, setNewConsultant] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const contactsByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) m.set(c.accountId, (m.get(c.accountId) ?? 0) + 1);
    return m;
  }, [contacts]);

  const counts = useMemo(() => ({
    active: accounts.filter((a) => a.status === 'active').length,
    prospect: accounts.filter((a) => a.status === 'prospect').length,
    inactive: accounts.filter((a) => a.status === 'inactive').length,
  }), [accounts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts
      .filter((a) => statusOn[a.status])
      .filter((a) => (entityFilter ? a.entity === entityFilter : true))
      .filter((a) => (regionFilter ? a.region === regionFilter : true))
      .filter((a) => (needle
        ? [a.name, a.keyContact, a.staffingConsultant, a.ownerNote, a.notes]
            .filter(Boolean)
            .some((s) => (s as string).toLowerCase().includes(needle))
        : true))
      .sort((a, b) => {
        const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
        if (r !== 0) return r;
        return a.name.localeCompare(b.name);
      });
  }, [accounts, statusOn, q, entityFilter, regionFilter, ]);

  const drawerAccount = drawerId ? accounts.find((a) => a.id === drawerId) ?? null : null;
  const drawerContacts = drawerId ? contacts.filter((c) => c.accountId === drawerId) : [];

  const resetAddForm = () => {
    setNewName(''); setNewEntity('SI'); setNewRegion('USA');
    setNewWorkType(''); setNewStatus('active'); setNewKeyContact('');
    setNewConsultant(''); setNewOwner(''); setNewNotes('');
  };

  const submitAdd = async () => {
    if (!newName.trim()) return;
    await addAccount({
      name: newName,
      entity: newEntity,
      region: newRegion,
      workType: (newWorkType || null) as TnmWorkType | null,
      keyContact: newKeyContact || null,
      staffingConsultant: newConsultant || null,
      ownerNote: newOwner || null,
      notes: newNotes || null,
      status: newStatus,
    });
    resetAddForm();
    setAdding(false);
    // Ensure the newly-added status bucket is visible so the tile appears.
    setStatusOn((s) => ({ ...s, [newStatus]: true }));
  };

  const total = accounts.length;
  const shownCount = filtered.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="TNM Accounts"
        subtitle="Global Time & Materials — SI partners, direct end clients, and prospects all in one place."
      />

      {/* Status chip row + Add button */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip
          label="Active"
          count={counts.active}
          tone="active"
          on={statusOn.active}
          onClick={() => setStatusOn((s) => ({ ...s, active: !s.active }))}
        />
        <StatusChip
          label="Prospect"
          count={counts.prospect}
          tone="prospect"
          on={statusOn.prospect}
          onClick={() => setStatusOn((s) => ({ ...s, prospect: !s.prospect }))}
        />
        <StatusChip
          label="Inactive"
          count={counts.inactive}
          tone="inactive"
          on={statusOn.inactive}
          onClick={() => setStatusOn((s) => ({ ...s, inactive: !s.inactive }))}
        />
        <span className="text-[11px] text-muted ml-1">{shownCount} of {total} shown</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="ml-auto px-3.5 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold flex items-center gap-1.5 hover:brightness-105 transition"
        >
          <Plus size={14} />
          {adding ? 'Cancel' : 'Add account'}
        </button>
      </div>

      {/* Search + Entity + Region */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px] relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, contact, consultant, note…"
            className="w-full pl-8 pr-2 py-2 rounded-lg border border-line text-sm bg-surface focus:outline-none focus:border-primary"
          />
        </div>
        <div className="w-40">
          <Select
            options={[
              { label: 'All entities', value: '' },
              ...TNM_ENTITY_OPTIONS.map((v) => ({ label: v, value: v })),
            ]}
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value as TnmEntity | '')}
          />
        </div>
        <div className="w-36">
          <Select
            options={[
              { label: 'All regions', value: '' },
              ...TNM_REGION_OPTIONS.map((v) => ({ label: v, value: v })),
            ]}
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value as TnmRegion | '')}
          />
        </div>
      </div>

      {adding && (
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Account name *"
              placeholder="e.g. Persistent Systems"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <Select
              label="Entity *"
              options={TNM_ENTITY_OPTIONS.map((v) => ({ label: v, value: v }))}
              value={newEntity}
              onChange={(e) => setNewEntity(e.target.value as TnmEntity)}
            />
            <Select
              label="Region *"
              options={TNM_REGION_OPTIONS.map((v) => ({ label: v, value: v }))}
              value={newRegion}
              onChange={(e) => setNewRegion(e.target.value as TnmRegion)}
            />
            <Select
              label="Work type"
              placeholder="(unspecified)"
              options={TNM_WORK_TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
              value={newWorkType}
              onChange={(e) => setNewWorkType(e.target.value as TnmWorkType | '')}
            />
            <Select
              label="Status *"
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Prospect', value: 'prospect' },
                { label: 'Inactive', value: 'inactive' },
              ]}
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as TnmStatus)}
            />
            <Input
              label="Key contact"
              placeholder="Person we deal with"
              value={newKeyContact}
              onChange={(e) => setNewKeyContact(e.target.value)}
            />
            <Input
              label="Consultant used"
              placeholder="Who did we place / propose"
              value={newConsultant}
              onChange={(e) => setNewConsultant(e.target.value)}
            />
            <Input
              label="Owner / note"
              placeholder="e.g. Pragna, Raghu to forward"
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
            />
            <div className="md:col-span-3">
              <Textarea
                label="Notes"
                placeholder="Freeform"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
            </div>
            <div className="md:col-span-3 flex justify-end">
              <button
                onClick={submitAdd}
                disabled={!newName.trim()}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-40 hover:brightness-105 transition"
              >
                Create account
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Tile grid */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={total === 0 ? 'No accounts yet' : 'No accounts match'}
            description={total === 0
              ? 'Add your first SI partner, direct end client, or prospect using the button above.'
              : 'Try turning on more status chips, clearing filters, or clearing the search.'}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((a) => (
            <AccountTile
              key={a.id}
              account={a}
              contactCount={contactsByAccount.get(a.id) ?? 0}
              onOpen={() => setDrawerId(a.id)}
              onConvert={() => setStatus(a.id, 'active')}
              onPromote={async () => {
                const label = a.entity === 'SI' ? 'SI' : 'MSP';
                if (!window.confirm(`Promote "${a.name}" to Global Demand as ${label}? This copies the account + ${contactsByAccount.get(a.id) ?? 0} contact(s) into Global Demand and marks this TNM row inactive.`)) return;
                const res = await promoteToGlobalDemand(a.id);
                if (res) {
                  window.alert(`Promoted. "${a.name}" is now a Global Demand ${label} account. Open /us-staffing to see it.`);
                } else {
                  window.alert(`Couldn't promote — already promoted, or not found.`);
                }
              }}
              onRemove={() => {
                if (window.confirm(`Delete "${a.name}"? This will remove ${contactsByAccount.get(a.id) ?? 0} contacts.`)) {
                  removeAccount(a.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      <Drawer
        open={!!drawerAccount}
        onClose={() => setDrawerId(null)}
        title={drawerAccount?.name ?? 'Account'}
        width="max-w-xl"
      >
        {drawerAccount && (
          <AccountDrawer
            key={drawerAccount.id}
            account={drawerAccount}
            contacts={drawerContacts}
            onPatch={(patch) => updateAccount(drawerAccount.id, patch)}
            onAddContact={(p) => addContact(drawerAccount.id, p)}
            onPatchContact={(id, patch) => updateContact(id, patch)}
            onRemoveContact={(id) => removeContact(id)}
          />
        )}
      </Drawer>
    </div>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────

function AccountTile({
  account, contactCount, onOpen, onConvert, onPromote, onRemove,
}: {
  account: TnmAccount;
  contactCount: number;
  onOpen: () => void;
  onConvert: () => void;
  onPromote: () => void;
  onRemove: () => void;
}) {
  const isProspect = account.status === 'prospect';
  const isInactive = account.status === 'inactive';
  const isPromoted = !!account.promotedToUsId;
  const borderTone =
    account.status === 'active'   ? 'border-emerald-200 hover:border-emerald-400' :
    account.status === 'prospect' ? 'border-amber-200 hover:border-amber-400' :
                                     'border-line/70 hover:border-line';
  return (
    <div
      className={`group relative rounded-xl border ${borderTone} bg-surface p-4 transition ${isInactive ? 'opacity-70' : ''}`}
    >
      {/* Top row: status pill + row actions */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <StatusPill status={account.status} />
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          {isProspect && (
            <button
              onClick={onConvert}
              title="Convert to active TNM account"
              className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 transition"
            >
              <ArrowRightCircle size={14} />
            </button>
          )}
          {!isPromoted && !isInactive && (
            <button
              onClick={onPromote}
              title="Promote to Global Demand account"
              className="p-1 rounded-md text-indigo-600 hover:bg-indigo-50 transition"
            >
              <Rocket size={14} />
            </button>
          )}
          {isPromoted && (
            <span
              title="Already promoted to Global Demand"
              className="p-1 rounded-md text-emerald-700 bg-emerald-50 inline-flex items-center gap-1 text-[10px] font-semibold"
            >
              <Check size={12} /> promoted
            </span>
          )}
          <button
            onClick={onRemove}
            title="Delete account"
            className="p-1 rounded-md text-red-500 hover:bg-red-50 transition"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Name — click opens drawer */}
      <button
        onClick={onOpen}
        className="block text-left w-full mb-2 group/name"
      >
        <div className="text-base font-bold text-ink group-hover/name:text-primary transition truncate">
          {account.name}
        </div>
      </button>

      {/* Chips row — entity + region + work-type */}
      <div className="flex flex-wrap gap-1 mb-3">
        <MiniChip icon={Building2}>{account.entity}</MiniChip>
        <MiniChip icon={MapPin}>{account.region}</MiniChip>
        {account.workType && <MiniChip>{account.workType}</MiniChip>}
      </div>

      {/* Facts */}
      <div className="space-y-1 text-[12px] text-ink/80">
        {account.keyContact && (
          <div className="flex items-center gap-1.5 truncate">
            <User size={11} className="text-muted flex-shrink-0" />
            <span className="text-muted uppercase tracking-wider text-[9.5px]">Contact</span>
            <span className="truncate">{account.keyContact}</span>
          </div>
        )}
        {account.staffingConsultant && (
          <div className="flex items-center gap-1.5 truncate">
            <Users size={11} className="text-muted flex-shrink-0" />
            <span className="text-muted uppercase tracking-wider text-[9.5px]">Consultant</span>
            <span className="truncate">{account.staffingConsultant}</span>
          </div>
        )}
      </div>

      {/* Owner note */}
      {account.ownerNote && (
        <div className="mt-3 text-[11px] text-muted italic border-t border-line/40 pt-2 line-clamp-2">
          {account.ownerNote}
        </div>
      )}

      {/* Footer: contact count */}
      <div className="mt-3 pt-2 border-t border-line/40 flex items-center justify-between text-[11px] text-muted">
        <button onClick={onOpen} className="hover:text-primary transition">
          {contactCount === 0 ? '+ add contact' : `${contactCount} contact${contactCount === 1 ? '' : 's'}`}
        </button>
        <button onClick={onOpen} className="hover:text-primary transition">
          Edit →
        </button>
      </div>
    </div>
  );
}

function MiniChip({ icon: Icon, children }: { icon?: React.ComponentType<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-2 text-[10.5px] font-semibold text-ink/80 border border-line/60">
      {Icon && <Icon size={9} className="text-muted" />}
      {children}
    </span>
  );
}

function StatusChip({
  label, count, tone, on, onClick,
}: {
  label: string;
  count: number;
  tone: 'active' | 'prospect' | 'inactive';
  on: boolean;
  onClick: () => void;
}) {
  const activeTone =
    tone === 'active' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' :
    tone === 'prospect' ? 'bg-amber-500 text-white border-amber-500 shadow-sm' :
    'bg-slate-500 text-white border-slate-500 shadow-sm';
  const offTone = 'bg-surface text-muted border-line hover:border-primary hover:text-primary';
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[12px] font-semibold border transition ${on ? activeTone : offTone}`}
    >
      {label} <span className={`ml-1 text-[10.5px] ${on ? 'opacity-80' : 'opacity-60'}`}>{count}</span>
    </button>
  );
}

// ─── Drawer (detail + contacts) — preserved from previous impl ────────

function AccountDrawer({
  account, contacts, onPatch, onAddContact, onPatchContact, onRemoveContact,
}: {
  account: TnmAccount;
  contacts: TnmAccountContact[];
  onPatch: (patch: Partial<TnmAccount>) => void;
  onAddContact: (p: { name: string; email?: string | null; phone?: string | null; title?: string | null; notes?: string | null }) => void;
  onPatchContact: (id: string, patch: Partial<TnmAccountContact>) => void;
  onRemoveContact: (id: string) => void;
}) {
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addTitle, setAddTitle] = useState('');

  const submit = () => {
    if (!addName.trim()) return;
    onAddContact({ name: addName, email: addEmail || null, phone: addPhone || null, title: addTitle || null });
    setAddName(''); setAddEmail(''); setAddPhone(''); setAddTitle('');
  };

  return (
    <div className="space-y-6">
      {/* Editable core fields */}
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Entity"
          options={TNM_ENTITY_OPTIONS.map((v) => ({ label: v, value: v }))}
          value={account.entity}
          onChange={(e) => onPatch({ entity: e.target.value as TnmEntity })}
        />
        <Select
          label="Region"
          options={TNM_REGION_OPTIONS.map((v) => ({ label: v, value: v }))}
          value={account.region}
          onChange={(e) => onPatch({ region: e.target.value as TnmRegion })}
        />
        <Select
          label="Work type"
          placeholder="(unspecified)"
          options={TNM_WORK_TYPE_OPTIONS.map((v) => ({ label: v, value: v }))}
          value={account.workType ?? ''}
          onChange={(e) => onPatch({ workType: (e.target.value || null) as TnmWorkType | null })}
        />
        <DraftInput
          label="Key contact"
          placeholder="Person we deal with"
          initial={account.keyContact}
          onCommit={(v) => onPatch({ keyContact: v || null })}
        />
        <div className="col-span-2">
          <DraftInput
            label="Consultant used"
            placeholder="Who did we place / propose"
            initial={account.staffingConsultant}
            onCommit={(v) => onPatch({ staffingConsultant: v || null })}
          />
        </div>
        <div className="col-span-2">
          <DraftInput
            label="Owner / note"
            placeholder="e.g. Pragna, Raghu to forward"
            initial={account.ownerNote}
            onCommit={(v) => onPatch({ ownerNote: v || null })}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Notes</label>
        <DraftTextarea
          rows={4}
          initial={account.notes}
          placeholder="Freeform — saves when you click away"
          onCommit={(v) => onPatch({ notes: v || null })}
        />
      </div>

      {/* Contacts */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-sm font-bold text-ink flex items-center gap-2">
            <UserPlus size={15} /> Contacts <span className="text-xs text-muted font-normal">({contacts.length})</span>
          </h3>
        </div>
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="border border-line rounded-lg p-3 space-y-2">
              <div className="flex gap-2">
                <DraftText
                  className="flex-1 px-2 py-1 rounded border border-line text-sm font-semibold bg-surface"
                  initial={c.name}
                  onCommit={(v) => { if (v.trim()) onPatchContact(c.id, { name: v }); }}
                />
                <button
                  onClick={() => onRemoveContact(c.id)}
                  className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                  title="Remove contact"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <DraftText
                  className="px-2 py-1 rounded border border-line text-xs bg-surface"
                  placeholder="Title"
                  initial={c.title}
                  onCommit={(v) => onPatchContact(c.id, { title: v || null })}
                />
                <DraftText
                  className="px-2 py-1 rounded border border-line text-xs bg-surface"
                  placeholder="Email"
                  initial={c.email}
                  onCommit={(v) => onPatchContact(c.id, { email: v || null })}
                />
                <DraftText
                  className="px-2 py-1 rounded border border-line text-xs col-span-2 bg-surface"
                  placeholder="Phone"
                  initial={c.phone}
                  onCommit={(v) => onPatchContact(c.id, { phone: v || null })}
                />
              </div>
            </div>
          ))}

          <div className="border-2 border-dashed border-line rounded-lg p-3 space-y-2">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">Add contact</div>
            <input
              className="w-full px-2 py-1 rounded border border-line text-sm bg-surface"
              placeholder="Name *"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="px-2 py-1 rounded border border-line text-xs bg-surface"
                placeholder="Title"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
              />
              <input
                className="px-2 py-1 rounded border border-line text-xs bg-surface"
                placeholder="Email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
              />
              <input
                className="px-2 py-1 rounded border border-line text-xs col-span-2 bg-surface"
                placeholder="Phone"
                value={addPhone}
                onChange={(e) => setAddPhone(e.target.value)}
              />
            </div>
            <button
              onClick={submit}
              disabled={!addName.trim()}
              className="w-full py-1.5 rounded bg-primary text-white text-xs font-semibold disabled:opacity-40"
            >
              Add contact
            </button>
          </div>
        </div>
      </div>

      {/* Status change */}
      <div className="pt-4 border-t border-line/60">
        <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Status</label>
        <div className="flex gap-2">
          {(['prospect', 'active', 'inactive'] as const).map((s) => (
            <button
              key={s}
              onClick={() => onPatch({ status: s })}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize border transition ${
                account.status === s
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-muted border-line hover:border-primary hover:text-primary'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {account.status === 'prospect' && (
          <p className="mt-2 text-[11px] text-muted italic">Convert to <strong>active</strong> when this account starts producing work.</p>
        )}
      </div>
    </div>
  );
}

// ─── Draft-committing fields ─────────────────────────────────────────
//
// These exist because the drawer used to call updateAccount() on EVERY
// keystroke. Each keystroke wrote the whole store to localStorage, fired a
// Supabase upsert, and re-rendered the entire tile grid — so typing a comment
// into a busy account crawled and characters were dropped. Now the text lives
// in local state while you type and commits ONCE, when the field loses focus
// (or on Enter, for single-line fields). Escape abandons the edit.
//
// Each is seeded from `initial` and never re-seeded while mounted; the drawer
// and each contact row carry a `key`, so switching account or row gives a
// fresh field with fresh values.

/** Commit-on-blur wrapper around the shared <Input>. */
function DraftInput({ label, placeholder, initial, onCommit }: {
  label?: string;
  placeholder?: string;
  initial: string | null | undefined;
  onCommit: (value: string) => void;
}) {
  const base = initial ?? '';
  const [v, setV] = useState(base);
  return (
    <Input
      label={label}
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== base) onCommit(v); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setV(base); e.currentTarget.blur(); }
      }}
    />
  );
}

/** Commit-on-blur bare <input>, for the compact contact rows. */
function DraftText({ className, placeholder, initial, onCommit }: {
  className?: string;
  placeholder?: string;
  initial: string | null | undefined;
  onCommit: (value: string) => void;
}) {
  const base = initial ?? '';
  const [v, setV] = useState(base);
  return (
    <input
      className={className}
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== base) onCommit(v); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { setV(base); e.currentTarget.blur(); }
      }}
    />
  );
}

/** Commit-on-blur textarea. Enter inserts a newline here, so only blur saves. */
function DraftTextarea({ rows = 4, placeholder, initial, onCommit }: {
  rows?: number;
  placeholder?: string;
  initial: string | null | undefined;
  onCommit: (value: string) => void;
}) {
  const base = initial ?? '';
  const [v, setV] = useState(base);
  return (
    <textarea
      className="w-full px-3 py-2 rounded-lg border border-line text-sm text-ink bg-surface resize-y focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      rows={rows}
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== base) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { setV(base); e.currentTarget.blur(); } }}
    />
  );
}

// ─── Small helpers ────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const tone = status === 'active'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : status === 'prospect'
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${tone}`}>
      {status}
    </span>
  );
}
