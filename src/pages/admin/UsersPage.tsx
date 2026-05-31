/**
 * Admin → Users. Lists the rows in `authorized_users` joined with auth.users
 * to show last sign-in. Lets admins add new emails (and optionally mark them
 * as admin) and remove existing ones.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, Badge, ConfirmDialog } from '../../components/ui';

type UserRole = 'admin' | 'manager' | 'employee';

interface AuthorizedUserRow {
  email: string;
  full_name: string | null;
  is_admin: boolean;
  role: UserRole;
  manager_email: string | null;
  employee_code: string | null;
  added_by: string | null;
  added_at: string;
  notes: string | null;
}

export default function UsersPage() {
  const [rows, setRows] = useState<AuthorizedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftAdmin, setDraftAdmin] = useState(false);
  const [draftRole, setDraftRole] = useState<UserRole>('employee');
  const [draftManager, setDraftManager] = useState('');
  const [draftEmpCode, setDraftEmpCode] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase
        .from('authorized_users')
        .select('email, full_name, is_admin, role, manager_email, employee_code, added_by, added_at, notes')
        .order('added_at', { ascending: false });
      if (e) throw e;
      setRows(data as AuthorizedUserRow[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleAdd = async () => {
    const email = draftEmail.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email.');
      return;
    }
    setAdding(true);
    try {
      const role: UserRole = draftAdmin ? 'admin' : draftRole;
      const { error: e } = await supabase.from('authorized_users').insert({
        email,
        full_name: draftName.trim() || null,
        is_admin: draftAdmin,
        role,
        manager_email: draftManager.trim().toLowerCase() || null,
        employee_code: draftEmpCode.trim() || null,
        notes: draftNotes.trim() || null,
        added_by: 'admin-ui',
      });
      if (e) throw e;
      setDraftEmail(''); setDraftName(''); setDraftAdmin(false); setDraftRole('employee');
      setDraftManager(''); setDraftEmpCode(''); setDraftNotes('');
      setShowAdd(false);
      setError(null);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const handleToggleAdmin = async (row: AuthorizedUserRow) => {
    try {
      const nextIsAdmin = !row.is_admin;
      const nextRole: UserRole = nextIsAdmin ? 'admin' : (row.role === 'admin' ? 'employee' : row.role);
      const { error: e } = await supabase
        .from('authorized_users')
        .update({ is_admin: nextIsAdmin, role: nextRole })
        .eq('email', row.email);
      if (e) throw e;
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /** Patch any subset of editable columns on a single user. */
  const patchRow = async (email: string, patch: Partial<Pick<AuthorizedUserRow, 'role' | 'manager_email' | 'employee_code' | 'full_name'>>) => {
    try {
      // If role changes to/from 'admin', keep is_admin in sync.
      const update: Record<string, unknown> = { ...patch };
      if (patch.role !== undefined) update.is_admin = patch.role === 'admin';
      if (patch.manager_email !== undefined) update.manager_email = patch.manager_email?.toLowerCase() || null;
      if (patch.employee_code !== undefined) update.employee_code = patch.employee_code || null;
      const { error: e } = await supabase
        .from('authorized_users')
        .update(update)
        .eq('email', email);
      if (e) throw e;
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleRemove = async (email: string) => {
    try {
      const { error: e } = await supabase.from('authorized_users').delete().eq('email', email);
      if (e) throw e;
      setConfirmRemove(null);
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const adminCount = useMemo(() => rows.filter((r) => r.is_admin).length, [rows]);

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={`${rows.length} authorized · ${adminCount} admin${adminCount === 1 ? '' : 's'}`}
      />

      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-slate-500">
            Anyone on this list can sign in via magic link or Google. Admins additionally see this page,
            Activity, and the Audit Log.
          </p>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 flex items-center gap-1.5"
          >
            <Plus size={14} /> {showAdd ? 'Cancel' : 'Add user'}
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {showAdd && (
          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Email *</label>
                <input
                  type="email"
                  autoFocus
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                  placeholder="name@simpliigence.com"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Full name</label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Role</label>
                <select
                  value={draftAdmin ? 'admin' : draftRole}
                  onChange={(e) => {
                    const v = e.target.value as UserRole;
                    setDraftRole(v);
                    setDraftAdmin(v === 'admin');
                  }}
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm bg-white"
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Manager email</label>
                <input
                  type="email"
                  value={draftManager}
                  onChange={(e) => setDraftManager(e.target.value)}
                  list="manager-options"
                  placeholder="manager@…"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Employee code (Zoho)</label>
                <input
                  type="text"
                  value={draftEmpCode}
                  onChange={(e) => setDraftEmpCode(e.target.value)}
                  placeholder="Leave blank for Simpliigence-entered time"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Notes</label>
                <input
                  type="text"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="e.g. team / finance"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="md:col-span-2 flex items-end justify-end gap-2">
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {adding ? 'Adding…' : 'Add user'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              Employees signed in with role=employee see only /my-time. Managers can approve their direct reports on /my-team-time. Set the manager email here so that report→manager relationship is wired up.
            </p>
            {/* datalist of known emails for the Manager picker */}
            <datalist id="manager-options">
              {rows.map((r) => <option key={r.email} value={r.email} />)}
            </datalist>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="pb-3 pr-3 font-semibold text-slate-600">Email</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Name</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Role</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Manager</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Zoho code</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Notes</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Added</th>
                <th className="pb-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="py-8 text-center text-slate-400 text-sm">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-slate-400 text-sm">No authorized users.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.email} className="border-b border-slate-100 hover:bg-slate-50 group">
                  <td className="py-2.5 pr-3 font-medium text-slate-800">{r.email}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{r.full_name || <span className="text-slate-300">—</span>}</td>
                  <td className="py-2.5 pr-3">
                    <select
                      value={r.role}
                      onChange={(e) => patchRow(r.email, { role: e.target.value as UserRole })}
                      style={{ borderLeft: `3px solid ${r.role === 'admin' ? '#f59e0b' : r.role === 'manager' ? '#3b82f6' : '#94a3b8'}` }}
                      className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Admin</option>
                    </select>
                    {r.is_admin && r.role !== 'admin' && (
                      <button
                        onClick={() => handleToggleAdmin(r)}
                        title="Legacy is_admin=true but role!=admin — click to align"
                        className="ml-1 inline-flex items-center"
                      >
                        <Badge variant="warning"><ShieldCheck size={10} /></Badge>
                      </button>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <input
                      type="email"
                      list="manager-options"
                      value={r.manager_email ?? ''}
                      placeholder="—"
                      onChange={(e) => {
                        // optimistic local update so the dropdown reflects immediately
                        setRows((rs) => rs.map((x) => x.email === r.email ? { ...x, manager_email: e.target.value } : x));
                      }}
                      onBlur={(e) => patchRow(r.email, { manager_email: e.target.value.trim() })}
                      className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-44"
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input
                      type="text"
                      value={r.employee_code ?? ''}
                      placeholder="—"
                      onChange={(e) => {
                        setRows((rs) => rs.map((x) => x.email === r.email ? { ...x, employee_code: e.target.value } : x));
                      }}
                      onBlur={(e) => patchRow(r.email, { employee_code: e.target.value.trim() })}
                      className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-24"
                    />
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">{r.notes || '—'}</td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">
                    {new Date(r.added_at).toLocaleDateString()}
                    {r.added_by && <div className="text-[10px] text-slate-400">by {r.added_by}</div>}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => setConfirmRemove(r.email)}
                      className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity"
                      title="Remove access"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove access?"
        message={`Revoke access for "${confirmRemove}". They won't be able to read any data after their next page load. This action is logged.`}
        confirmLabel="Remove"
        onConfirm={() => confirmRemove && handleRemove(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
    </>
  );
}
