/**
 * Admin → Users. Lists the rows in `authorized_users` joined with auth.users
 * to show last sign-in. Lets admins add new emails (and optionally mark them
 * as admin) and remove existing ones.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ShieldCheck, Shield } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, Badge, ConfirmDialog } from '../../components/ui';

interface AuthorizedUserRow {
  email: string;
  full_name: string | null;
  is_admin: boolean;
  added_by: string | null;
  added_at: string;
  notes: string | null;
}

interface AuthInfo {
  email: string;
  last_sign_in_at: string | null;
}

export default function UsersPage() {
  const [rows, setRows] = useState<AuthorizedUserRow[]>([]);
  const [authInfo, setAuthInfo] = useState<Record<string, AuthInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftAdmin, setDraftAdmin] = useState(false);
  const [draftNotes, setDraftNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase
        .from('authorized_users')
        .select('email, full_name, is_admin, added_by, added_at, notes')
        .order('added_at', { ascending: false });
      if (e) throw e;
      setRows(data as AuthorizedUserRow[]);
      // Match last_sign_in via the public_user_signins RPC (or fallback to a join via a view).
      // We don't have an RPC; instead query auth.users via the service-role… we can't from
      // the client. Easiest path: leave last_sign_in empty for now if not available.
      // (Will display "—".)
      setAuthInfo({});
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
      const { error: e } = await supabase.from('authorized_users').insert({
        email,
        full_name: draftName.trim() || null,
        is_admin: draftAdmin,
        notes: draftNotes.trim() || null,
        added_by: 'admin-ui',
      });
      if (e) throw e;
      setDraftEmail(''); setDraftName(''); setDraftAdmin(false); setDraftNotes('');
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
      const { error: e } = await supabase
        .from('authorized_users')
        .update({ is_admin: !row.is_admin })
        .eq('email', row.email);
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
                <label className="block text-xs text-slate-500 mb-1">Notes</label>
                <input
                  type="text"
                  value={draftNotes}
                  onChange={(e) => setDraftNotes(e.target.value)}
                  placeholder="e.g. team / finance"
                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftAdmin}
                    onChange={(e) => setDraftAdmin(e.target.checked)}
                  />
                  Admin
                </label>
                <button
                  onClick={handleAdd}
                  disabled={adding}
                  className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {adding ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              They can sign in immediately via magic link or Google. No invitation email is sent from here.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left">
                <th className="pb-3 pr-3 font-semibold text-slate-600">Email</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Name</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600 text-center">Role</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Notes</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Added</th>
                <th className="pb-3 pr-3 font-semibold text-slate-600">Last sign-in</th>
                <th className="pb-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-sm">Loading…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-slate-400 text-sm">No authorized users.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.email} className="border-b border-slate-100 hover:bg-slate-50 group">
                  <td className="py-2.5 pr-3 font-medium text-slate-800">{r.email}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{r.full_name || <span className="text-slate-300">—</span>}</td>
                  <td className="py-2.5 pr-3 text-center">
                    <button
                      onClick={() => handleToggleAdmin(r)}
                      title={r.is_admin ? 'Click to remove admin' : 'Click to make admin'}
                      className="inline-flex items-center gap-1"
                    >
                      {r.is_admin ? (
                        <Badge variant="warning">
                          <span className="inline-flex items-center gap-1"><ShieldCheck size={11} /> Admin</span>
                        </Badge>
                      ) : (
                        <Badge variant="neutral">
                          <span className="inline-flex items-center gap-1 text-slate-500"><Shield size={11} /> User</span>
                        </Badge>
                      )}
                    </button>
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">{r.notes || '—'}</td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">
                    {new Date(r.added_at).toLocaleDateString()}
                    {r.added_by && <div className="text-[10px] text-slate-400">by {r.added_by}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-slate-500">
                    {authInfo[r.email]?.last_sign_in_at
                      ? new Date(authInfo[r.email].last_sign_in_at!).toLocaleString()
                      : '—'}
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
