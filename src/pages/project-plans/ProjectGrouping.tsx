/**
 * Strip under the project header: which account and segment the project sits
 * in, who owes the weekly check-in, and the Teams / Slack channels the issue
 * extractor reads.
 */
import { useEffect, useState } from 'react';
import { Building2, ClipboardCheck, Radio } from 'lucide-react';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { alertError } from '../../lib/planToast';
import { useDeliveryAccounts, SEGMENT_LABEL, SEGMENTS, checkinState, CHECKIN_STYLE } from '../../lib/deliveryRebuild';
import { EditCell } from './planUi';
import type { DeliveryProject } from '../../types/delivery';

export function ProjectGrouping({ project, canEdit }: { project: DeliveryProject; canEdit: boolean }) {
  const { accounts, loaded, load } = useDeliveryAccounts();
  const updateProject = useDeliveryStore((s) => s.updateProject);
  const summary = useDeliveryStore((s) => s.summaries[project.id]);
  const people = useDeliveryStore((s) => s.people);
  const loadPeople = useDeliveryStore((s) => s.loadPeople);
  const [showSources, setShowSources] = useState(false);
  useEffect(() => { if (!loaded) load().catch(alertError); void loadPeople(); }, [loaded, load, loadPeople]);

  const account = accounts.find((a) => a.id === project.accountId);
  const ck = checkinState(summary?.lastCheckin ?? null, project.status === 'active');
  const save = (patch: Parameters<typeof updateProject>[1]) => updateProject(project.id, patch).catch(alertError);

  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm">
          <Building2 size={15} className="text-muted" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Account</span>
          <select value={project.accountId ?? ''} disabled={!canEdit} onChange={(e) => save({ accountId: e.target.value || null })}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm font-semibold text-ink disabled:opacity-80">
            <option value="">— none —</option>
            {SEGMENTS.map((s) => (
              <optgroup key={s.key} label={s.label}>
                {accounts.filter((a) => a.segment === s.key).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </optgroup>
            ))}
          </select>
          {account && <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{SEGMENT_LABEL[account.segment]}</span>}
        </label>

        <label className="flex items-center gap-2 text-sm">
          <ClipboardCheck size={15} className="text-muted" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Weekly check-in by</span>
          <select value={project.checkinOwner ?? ''} disabled={!canEdit} onChange={(e) => save({ checkinOwner: e.target.value || null })}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-sm font-semibold text-ink disabled:opacity-80">
            <option value="">— nobody —</option>
            {people.map((p) => <option key={p.email} value={p.email.toLowerCase()}>{p.fullName}</option>)}
            {project.checkinOwner && !people.some((p) => p.email.toLowerCase() === project.checkinOwner) && <option value={project.checkinOwner}>{project.checkinOwner}</option>}
          </select>
          {ck !== 'na' && <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ring-1 ring-inset ${CHECKIN_STYLE[ck].cls}`}>{CHECKIN_STYLE[ck].label}</span>}
        </label>

        <button onClick={() => setShowSources(!showSources)} className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink">
          <Radio size={13} /> Issue sources{project.teamsChannelId || project.slackChannelId ? '' : ' · email + status reports only'}
        </button>
      </div>
      {showSources && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-line/60 pt-3 text-xs text-muted">
          <div>
            <div className="font-semibold mb-1">Teams channel <span className="font-normal">(teamId/channelId)</span></div>
            <EditCell value={project.teamsChannelId} disabled={!canEdit} placeholder="Paste from the channel’s “Get link”" onSave={(v) => updateProject(project.id, { teamsChannelId: parseTeams(v) })} />
          </div>
          <div>
            <div className="font-semibold mb-1">Slack channel ID</div>
            <EditCell value={project.slackChannelId} disabled={!canEdit} placeholder="e.g. C07ABCDE123" onSave={(v) => updateProject(project.id, { slackChannelId: v })} />
          </div>
          <div className="md:col-span-2">Email from the check-in owner’s and PMs’ mailboxes is matched to this project by client domain and keywords; status-report documents in the project’s folder are read too. Suggestions land on the Issues tab.</div>
        </div>
      )}
    </div>
  );
}

/** Accept a Teams “Get link to channel” URL or a raw teamId/channelId. */
function parseTeams(v: string): string {
  const t = v.trim();
  if (!t.startsWith('http')) return t;
  try {
    const u = new URL(t);
    const channel = decodeURIComponent(u.pathname.split('/').find((p) => p.includes('@thread')) ?? '');
    const team = u.searchParams.get('groupId') ?? '';
    return team && channel ? `${team}/${channel}` : t;
  } catch { return t; }
}
