/**
 * TNM Accounts — Global T&M > TNM Accounts tab.
 *
 * Two views:
 *   • TNM Accounts (status = active or inactive) — past-work accounts
 *   • Prospects (status = prospect) — targets the salesperson is going after
 *
 * A Convert-to-TNM-Account button flips a prospect to active.
 *
 * Every field is inline-editable directly in the row: entity (SI/End Client),
 * work_type (Project SOW/Client), region, key_contact, staffing_consultant,
 * owner_note. Full detail + contacts CRUD in the right drawer.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, ArrowRightCircle, UserPlus, Building2, MapPin, User, Users } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Drawer, Input, Select, Textarea, EmptyState } from '../components/ui';
import { useTnmAccountsStore } from '../store/useTnmAccountsStore';
import {
  TNM_ENTITY_OPTIONS, TNM_WORK_TYPE_OPTIONS, TNM_REGION_OPTIONS,
} from '../types/tnmAccount';
import type { TnmAccount, TnmEntity, TnmWorkType, TnmRegion } from '../types/tnmAccount';

type Tab = 'accounts' | 'prospects';

export default function TnmAccountsPage() {
  const {
    accounts, contacts,
    addAccount, updateAccount, removeAccount, setStatus,
    addContact, updateContact, removeContact,
  } = useTnmAccountsStore();

  const [tab, setTab] = useState<Tab>('accounts');
  const [q, setQ] = useState('');
  const [entityFilter, setEntityFilter] = useState<TnmEntity | ''>('');
  const [regionFilter, setRegionFilter] = useState<TnmRegion | ''>('');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Fresh values for the add form (state hoisted so the form can be
  // rendered inside the top card).
  const [newName, setNewName] = useState('');
  const [newEntity, setNewEntity] = useState<TnmEntity>('SI');
  const [newRegion, setNewRegion] = useState<TnmRegion>('USA');
  const [newWorkType, setNewWorkType] = useState<TnmWorkType | ''>('');
  const [newKeyContact, setNewKeyContact] = useState('');
  const [newConsultant, setNewConsultant] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const contactsByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contacts) m.set(c.accountId, (m.get(c.accountId) ?? 0) + 1);
    return m;
  }, [contacts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts
      .filter((a) => (tab === 'prospects' ? a.status === 'prospect' : a.status !== 'prospect'))
      .filter((a) => (entityFilter ? a.entity === entityFilter : true))
      .filter((a) => (regionFilter ? a.region === regionFilter : true))
      .filter((a) => (needle
        ? [a.name, a.keyContact, a.staffingConsultant, a.ownerNote, a.notes]
            .filter(Boolean)
            .some((s) => (s as string).toLowerCase().includes(needle))
        : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [accounts, tab, q, entityFilter, regionFilter]);

  const counts = useMemo(() => ({
    accounts: accounts.filter((a) => a.status !== 'prospect').length,
    prospects: accounts.filter((a) => a.status === 'prospect').length,
  }), [accounts]);

  const drawerAccount = drawerId ? accounts.find((a) => a.id === drawerId) ?? null : null;
  const drawerContacts = drawerId ? contacts.filter((c) => c.accountId === drawerId) : [];

  const resetAddForm = () => {
    setNewName(''); setNewEntity('SI'); setNewRegion('USA');
    setNewWorkType(''); setNewKeyContact(''); setNewConsultant('');
    setNewOwner(''); setNewNotes('');
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
      // Prospects tab creates prospect; TNM Accounts tab creates active.
      status: tab === 'prospects' ? 'prospect' : 'active',
    });
    resetAddForm();
    setAdding(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="TNM Accounts"
        subtitle="Global T&M staffing accounts — SIs and End Clients we've contracted with, plus prospects to go after."
      />

      {/* Tab switcher */}
      <div className="flex items-center gap-2">
        <TabButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>
          TNM Accounts <span className="ml-1.5 text-xs text-muted">{counts.accounts}</span>
        </TabButton>
        <TabButton active={tab === 'prospects'} onClick={() => setTab('prospects')}>
          Prospects <span className="ml-1.5 text-xs text-muted">{counts.prospects}</span>
        </TabButton>
      </div>

      {/* Toolbar */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <Input
              label="Search"
              placeholder="Search by name, contact, consultant, note…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="w-40">
            <Select
              label="Entity"
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
              label="Region"
              options={[
                { label: 'All regions', value: '' },
                ...TNM_REGION_OPTIONS.map((v) => ({ label: v, value: v })),
              ]}
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value as TnmRegion | '')}
            />
          </div>
          <button
            onClick={() => setAdding((v) => !v)}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold flex items-center gap-2 hover:brightness-105 transition"
          >
            <Plus size={16} />
            {adding ? 'Cancel' : (tab === 'prospects' ? 'Add prospect' : 'Add account')}
          </button>
        </div>

        {adding && (
          <div className="mt-4 pt-4 border-t border-line/60 grid grid-cols-1 md:grid-cols-3 gap-3">
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
                Create {tab === 'prospects' ? 'prospect' : 'account'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card flush>
        {filtered.length === 0 ? (
          <EmptyState
            title={tab === 'prospects' ? 'No prospects yet' : 'No accounts match'}
            description={tab === 'prospects'
              ? 'Add prospective accounts here — they convert to TNM accounts when the status changes.'
              : 'Try clearing filters, or add a new account with the button above.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted border-b border-line/70">
                  <th className="text-left px-4 py-3 font-semibold">Account</th>
                  <th className="text-left px-3 py-3 font-semibold">Entity</th>
                  <th className="text-left px-3 py-3 font-semibold">Work type</th>
                  <th className="text-left px-3 py-3 font-semibold">Region</th>
                  <th className="text-left px-3 py-3 font-semibold">Consultant used</th>
                  <th className="text-left px-3 py-3 font-semibold">Key contact</th>
                  <th className="text-left px-3 py-3 font-semibold">Owner note</th>
                  <th className="text-left px-3 py-3 font-semibold">Contacts</th>
                  <th className="text-left px-3 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    contactCount={contactsByAccount.get(a.id) ?? 0}
                    onOpen={() => setDrawerId(a.id)}
                    onPatch={(patch) => updateAccount(a.id, patch)}
                    onConvert={() => setStatus(a.id, 'active')}
                    onRemove={() => {
                      if (window.confirm(`Delete "${a.name}"? This will remove ${contactsByAccount.get(a.id) ?? 0} contacts.`)) {
                        removeAccount(a.id);
                      }
                    }}
                    isProspect={tab === 'prospects'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail drawer */}
      <Drawer
        open={!!drawerAccount}
        onClose={() => setDrawerId(null)}
        title={drawerAccount?.name ?? 'Account'}
        width="max-w-xl"
      >
        {drawerAccount && (
          <AccountDrawer
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

// ─── Row (inline editable) ────────────────────────────────────────────

function AccountRow({
  account, contactCount, onOpen, onPatch, onConvert, onRemove, isProspect,
}: {
  account: TnmAccount;
  contactCount: number;
  onOpen: () => void;
  onPatch: (patch: Partial<TnmAccount>) => void;
  onConvert: () => void;
  onRemove: () => void;
  isProspect: boolean;
}) {
  return (
    <tr className="border-b border-line/40 hover:bg-surface-2/40 transition">
      <td className="px-4 py-3">
        <button
          onClick={onOpen}
          className="text-left font-semibold text-ink hover:text-primary transition"
        >
          {account.name}
        </button>
      </td>
      <td className="px-3 py-2">
        <InlineSelect
          value={account.entity}
          options={TNM_ENTITY_OPTIONS}
          onChange={(v) => onPatch({ entity: v as TnmEntity })}
        />
      </td>
      <td className="px-3 py-2">
        <InlineSelect
          value={account.workType ?? ''}
          placeholder="—"
          options={TNM_WORK_TYPE_OPTIONS}
          onChange={(v) => onPatch({ workType: (v || null) as TnmWorkType | null })}
        />
      </td>
      <td className="px-3 py-2">
        <InlineSelect
          value={account.region}
          options={TNM_REGION_OPTIONS}
          onChange={(v) => onPatch({ region: v as TnmRegion })}
        />
      </td>
      <td className="px-3 py-2">
        <InlineText
          value={account.staffingConsultant ?? ''}
          placeholder="—"
          onChange={(v) => onPatch({ staffingConsultant: v || null })}
        />
      </td>
      <td className="px-3 py-2">
        <InlineText
          value={account.keyContact ?? ''}
          placeholder="—"
          onChange={(v) => onPatch({ keyContact: v || null })}
        />
      </td>
      <td className="px-3 py-2">
        <InlineText
          value={account.ownerNote ?? ''}
          placeholder="—"
          onChange={(v) => onPatch({ ownerNote: v || null })}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <button
          onClick={onOpen}
          className="text-xs text-primary font-semibold hover:underline"
        >
          {contactCount === 0 ? '+ add' : `${contactCount}`}
        </button>
      </td>
      <td className="px-3 py-2">
        <StatusPill status={account.status} />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-1">
          {isProspect && (
            <button
              onClick={onConvert}
              title="Convert to TNM account"
              className="p-1.5 rounded-md text-emerald-600 hover:bg-emerald-50 transition"
            >
              <ArrowRightCircle size={16} />
            </button>
          )}
          <button
            onClick={onRemove}
            title="Delete account"
            className="p-1.5 rounded-md text-red-500 hover:bg-red-50 transition"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Drawer (detail + contacts) ────────────────────────────────────────

function AccountDrawer({
  account, contacts, onPatch, onAddContact, onPatchContact, onRemoveContact,
}: {
  account: TnmAccount;
  contacts: import('../types/tnmAccount').TnmAccountContact[];
  onPatch: (patch: Partial<TnmAccount>) => void;
  onAddContact: (p: { name: string; email?: string | null; phone?: string | null; title?: string | null; notes?: string | null }) => void;
  onPatchContact: (id: string, patch: Partial<import('../types/tnmAccount').TnmAccountContact>) => void;
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
      {/* Meta at a glance */}
      <div className="grid grid-cols-2 gap-3">
        <MetaTile icon={Building2} label="Entity" value={account.entity} />
        <MetaTile icon={MapPin} label="Region" value={account.region} />
        <MetaTile icon={User} label="Key contact" value={account.keyContact ?? '—'} />
        <MetaTile icon={Users} label="Consultant" value={account.staffingConsultant ?? '—'} />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Notes</label>
        <textarea
          className="w-full px-3 py-2 rounded-lg border border-line text-sm text-ink resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          rows={4}
          value={account.notes ?? ''}
          onChange={(e) => onPatch({ notes: e.target.value || null })}
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
                <input
                  className="flex-1 px-2 py-1 rounded border border-line text-sm font-semibold"
                  value={c.name}
                  onChange={(e) => onPatchContact(c.id, { name: e.target.value })}
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
                <input
                  className="px-2 py-1 rounded border border-line text-xs"
                  placeholder="Title"
                  value={c.title ?? ''}
                  onChange={(e) => onPatchContact(c.id, { title: e.target.value || null })}
                />
                <input
                  className="px-2 py-1 rounded border border-line text-xs"
                  placeholder="Email"
                  value={c.email ?? ''}
                  onChange={(e) => onPatchContact(c.id, { email: e.target.value || null })}
                />
                <input
                  className="px-2 py-1 rounded border border-line text-xs col-span-2"
                  placeholder="Phone"
                  value={c.phone ?? ''}
                  onChange={(e) => onPatchContact(c.id, { phone: e.target.value || null })}
                />
              </div>
            </div>
          ))}

          {/* Add contact */}
          <div className="border-2 border-dashed border-line rounded-lg p-3 space-y-2">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">Add contact</div>
            <input
              className="w-full px-2 py-1 rounded border border-line text-sm"
              placeholder="Name *"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className="px-2 py-1 rounded border border-line text-xs"
                placeholder="Title"
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
              />
              <input
                className="px-2 py-1 rounded border border-line text-xs"
                placeholder="Email"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
              />
              <input
                className="px-2 py-1 rounded border border-line text-xs col-span-2"
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
          <p className="mt-2 text-[11px] text-muted italic">Convert to <strong>active</strong> when this account starts producing work — it will move to the TNM Accounts tab.</p>
        )}
      </div>
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
        active
          ? 'bg-primary text-white border-primary shadow-sm'
          : 'bg-surface text-muted border-line hover:border-primary hover:text-primary'
      }`}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'active'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : status === 'prospect'
      ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${tone}`}>
      {status}
    </span>
  );
}

function InlineSelect({
  value, options, onChange, placeholder,
}: { value: string; options: string[]; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 rounded border border-transparent hover:border-line focus:border-primary text-sm text-ink bg-transparent focus:bg-surface transition"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function InlineText({
  value, onChange, placeholder,
}: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value);
  // Sync from parent when the underlying value updates (e.g. realtime).
  if (local !== value && document.activeElement?.tagName !== 'INPUT') {
    setLocal(value);
  }
  return (
    <input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => { if (local !== value) onChange(local); }}
      placeholder={placeholder}
      className="w-full px-2 py-1 rounded border border-transparent hover:border-line focus:border-primary text-sm text-ink bg-transparent focus:bg-surface transition placeholder:text-muted/60"
    />
  );
}

function MetaTile({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value: string }) {
  return (
    <div className="border border-line/70 rounded-lg p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">
        <Icon size={11} /> {label}
      </div>
      <div className="text-sm font-semibold text-ink truncate">{value}</div>
    </div>
  );
}
