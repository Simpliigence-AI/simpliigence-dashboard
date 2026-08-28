/**
 * Access matrix admin page.
 *
 * Owner-only route. Rows = every authorized user, columns = every page in
 * the catalog grouped by section. Each cell is a three-way dropdown:
 * None / Read / R+W. There's also a "Can view financials" checkbox column
 * so the owner can control who's allowed to reveal masked financial
 * values via the sidebar toggle.
 *
 * Owner (Raghu) is intentionally NOT in the row list — they always have
 * write and can always reveal financials at the code layer. Showing an
 * editable row would let them accidentally lock themselves out.
 *
 * Writes hit `user_page_access` (upsert) and `authorized_users`
 * (`can_view_financials` update). The store persists optimistically and
 * flushes to Supabase in the background.
 */
import { useEffect, useMemo, useState } from 'react';
import { db, fetchAuthorizedUsersForMatrix } from '../../lib/supabaseSync';
import { useAuthStore } from '../../store/useAuthStore';
import { useAccessStore } from '../../store/useAccessStore';
import { useIsOwner } from '../../components/OwnerOnly';
import { PAGES, PAGE_SECTIONS } from '../../lib/pageCatalog';
import type { AccessLevel } from '../../types/access';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, EmptyState } from '../../components/ui';
import { ShieldCheck, EyeOff, Eye } from 'lucide-react';

interface UserRow {
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  canViewFinancials: boolean;
}

export default function AccessMatrixPage() {
  const isOwner = useIsOwner();
  const currentEmail = useAuthStore((s) => s.currentUser?.email);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const setLevel = useAccessStore((s) => s.setLevel);
  const entries = useAccessStore((s) => s.entries);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchAuthorizedUsersForMatrix();
      if (!alive) return;
      // Drop the owner rows — they always have full access at the code
      // layer, and rendering them here would let them accidentally lock
      // themselves out with a stray click.
      const OWNER_EMAILS = new Set(['raghu@simpliigence.com', 'raghu.seetharam@simpliigence.com']);
      const filtered = (rows ?? []).filter((r) => !OWNER_EMAILS.has(r.email.toLowerCase()));
      filtered.sort((a, b) => (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email));
      setUsers(filtered);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const visibleUsers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((u) =>
      u.email.includes(needle) ||
      (u.fullName ?? '').toLowerCase().includes(needle),
    );
  }, [users, q]);

  const bySection = useMemo(() => {
    const map = new Map<string, typeof PAGES>();
    for (const s of PAGE_SECTIONS) map.set(s, []);
    for (const p of PAGES) map.get(p.section)!.push(p);
    return Array.from(map.entries());
  }, []);

  if (!isOwner) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Owner only"
        description="This page manages access grants across the app and is limited to the account owner."
      />
    );
  }

  const levelOf = (email: string, pageKey: string): AccessLevel => {
    const row = entries.find((e) => e.userEmail === email && e.pageKey === pageKey);
    return row?.level ?? 'none';
  };

  const onChangeLevel = (email: string, pageKey: string, level: AccessLevel) => {
    setLevel(email, pageKey, level, currentEmail ?? null);
  };

  const onToggleFinancials = async (email: string, next: boolean) => {
    setUsers((cur) => cur.map((u) => (u.email === email ? { ...u, canViewFinancials: next } : u)));
    await db.setUserCanViewFinancials(email, next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        tone="brand"
        title="Access matrix"
        subtitle="Set what every user can see and edit across the app, one page at a time. Owner bypasses the matrix."
      />

      <Card>
        <div className="flex items-baseline justify-between mb-3 flex-wrap gap-3">
          <div className="text-xs text-muted">
            {loading ? 'Loading users…' : `${visibleUsers.length} of ${users.length} users`}
            {' · '}
            {PAGES.length} pages across {PAGE_SECTIONS.length} sections
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name or email…"
            className="text-xs border border-line rounded-lg px-3 py-1.5 bg-surface-2 text-ink w-64"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="sticky left-0 z-20 bg-surface px-3 py-2 text-left font-semibold uppercase tracking-wider text-[10px] text-muted border-b border-line/60 min-w-[220px]">
                  User
                </th>
                <th className="px-3 py-2 text-center font-semibold uppercase tracking-wider text-[10px] text-muted border-b border-line/60 border-l border-line/40">
                  <span className="inline-flex items-center gap-1"><Eye size={11} /> Financials</span>
                </th>
                {bySection.map(([section, pages]) => (
                  <th
                    key={section}
                    colSpan={pages.length}
                    className="px-3 py-2 text-center font-bold uppercase tracking-wider text-[10px] text-primary border-b border-line/60 border-l border-line/40 bg-surface-2/50"
                  >
                    {section}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-20 bg-surface border-b border-line/60"></th>
                <th className="border-b border-line/60 border-l border-line/40"></th>
                {bySection.flatMap(([, pages]) =>
                  pages.map((p) => (
                    <th
                      key={p.key}
                      title={p.key}
                      className="px-1.5 py-2 text-[9px] font-semibold text-muted border-b border-line/60 border-l border-line/40 min-w-[86px] text-center"
                    >
                      {p.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => (
                <tr key={u.email} className="hover:bg-surface-2/40 group">
                  <td className="sticky left-0 z-10 bg-surface group-hover:bg-surface-2/60 border-b border-line/40 px-3 py-2">
                    <div className="font-semibold text-ink text-sm truncate">{u.fullName || u.email}</div>
                    <div className="text-[10px] text-muted truncate">{u.email}{u.isAdmin && ' · admin'}</div>
                  </td>
                  <td className="border-b border-line/40 border-l border-line/40 px-2 py-1 text-center">
                    <label className="inline-flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={u.canViewFinancials}
                        onChange={(e) => onToggleFinancials(u.email, e.target.checked)}
                        className="sr-only peer"
                      />
                      <span className="inline-flex items-center justify-center w-9 h-5 rounded-full bg-line/60 peer-checked:bg-emerald-500 relative transition">
                        <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-sm peer-checked:translate-x-4 transition" />
                      </span>
                    </label>
                  </td>
                  {bySection.flatMap(([, pages]) =>
                    pages.map((p) => (
                      <td key={p.key} className="border-b border-line/40 border-l border-line/40 px-1 py-1">
                        <LevelSelect
                          value={levelOf(u.email, p.key)}
                          onChange={(v) => onChangeLevel(u.email, p.key, v)}
                        />
                      </td>
                    )),
                  )}
                </tr>
              ))}
              {!loading && visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={2 + PAGES.length} className="p-6 text-center text-muted italic">
                    No users match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 pt-4 border-t border-line/60 text-[11px] text-muted flex items-center gap-2">
          <EyeOff size={12} /> Financial values across the app are masked by default. Users with the toggle on can click any masked value to reveal all financials for their session.
        </div>
      </Card>
    </div>
  );
}

function LevelSelect({ value, onChange }: { value: AccessLevel; onChange: (v: AccessLevel) => void }) {
  const cls: Record<AccessLevel, string> = {
    none:  'bg-line/30 text-muted',
    read:  'bg-blue-100 text-blue-700',
    write: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as AccessLevel)}
      className={`w-full text-[10px] font-semibold uppercase tracking-wider px-1.5 py-1 rounded ${cls[value]} border-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
    >
      <option value="none">None</option>
      <option value="read">Read</option>
      <option value="write">R+W</option>
    </select>
  );
}
