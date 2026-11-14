/**
 * Suggested profiles for one requisition.
 *
 * Pulls matching people out of the candidate database so nobody has to go and
 * search for them: profiles that share the role's skill pool, ranked by how much
 * of the role they cover. Unassigned (pool) profiles can be added to the role in
 * one click; profiles already on another role are shown with that role, and are
 * left where they are.
 *
 * Read-only until "Add to role" is clicked. Ranking lives in src/lib/skillPools.ts
 * and runs in the browser on data the staffing store already holds.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, UserPlus, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useStaffingStore } from '../../store/useStaffingStore';
import { suggestProfiles, poolsForRequisition, poolLabel } from '../../lib/skillPools';

interface Props {
  requisitionId: string;
  /** Start expanded. The table view keeps it collapsed so an expanded row stays short. */
  defaultOpen?: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export function SuggestedProfiles({ requisitionId, defaultOpen = true }: Props) {
  const { candidates, requisitions, updateCandidate } = useStaffingStore();
  const [open, setOpen] = useState(defaultOpen);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const req = useMemo(() => requisitions.find((r) => r.id === requisitionId), [requisitions, requisitionId]);
  const reqTitleById = useMemo(() => new Map(requisitions.map((r) => [r.id, r.title])), [requisitions]);

  // Only rank when the section is open: ~6k profiles is cheap, but not free on every keystroke in the form above.
  const suggestions = useMemo(
    () => (open && req ? suggestProfiles(req, candidates, 12) : []),
    [open, req, candidates],
  );
  const pools = useMemo(() => (req ? poolsForRequisition(req) : []), [req]);

  if (!req) return null;

  const add = (id: string) => {
    updateCandidate(id, { requisition_id: requisitionId, stage: 'Submitted', submit_date: today() });
    setAdded((s) => new Set(s).add(id));
  };

  const poolLink = pools[0] ? `/candidates?pool=${encodeURIComponent(pools[0])}` : '/candidates';

  return (
    <section className="rounded-lg border border-line/70 bg-surface-2/30">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        <Sparkles size={14} className="text-violet" />
        <span className="text-xs font-bold text-ink uppercase tracking-wider">Suggested from the database</span>
        {pools.length > 0 && (
          <span className="text-[11px] text-muted truncate">{pools.map(poolLabel).join(' · ')} pool</span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3">
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted">
              No matching profiles yet.{' '}
              {pools.length === 0 && 'This role does not map to a skill pool, so matching goes on the words in its title. '}
              <Link to={poolLink} className="text-primary font-semibold hover:underline">Search the database</Link>
            </p>
          ) : (
            <>
              <ul className="divide-y divide-line/60">
                {suggestions.map(({ candidate: c, matchedSkills, inPool }) => {
                  const isAdded = added.has(c.id);
                  const where = c.requisition_id ? reqTitleById.get(c.requisition_id) : null;
                  return (
                    <li key={c.id} className="py-2 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <Link to={`/candidates?q=${encodeURIComponent(c.email || c.name)}`}
                            className="text-sm font-semibold text-ink hover:text-primary hover:underline truncate">
                            {c.name || 'Unnamed profile'}
                          </Link>
                          {c.experience && <span className="text-xs text-muted truncate">{c.experience}</span>}
                          {c.years_of_experience != null && <span className="text-xs text-muted">{c.years_of_experience} yrs</span>}
                          {c.location && <span className="text-xs text-muted truncate">{c.location}</span>}
                        </div>
                        <div className="mt-1 flex items-center gap-1 flex-wrap">
                          {(matchedSkills.length ? matchedSkills : (c.skills || []).slice(0, 5)).map((s) => (
                            <span key={s} className="text-[10px] font-medium text-ink/75 bg-surface border border-line rounded-full px-1.5 py-0.5">{s}</span>
                          ))}
                        </div>
                      </div>
                      <div className="flex-shrink-0 pt-0.5">
                        {isAdded ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><Check size={13} /> Added</span>
                        ) : inPool ? (
                          <button type="button" onClick={() => add(c.id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary border border-primary/40 hover:bg-primary/10 rounded-md px-2 py-1">
                            <UserPlus size={12} /> Add to role
                          </button>
                        ) : (
                          <span className="block max-w-[11rem] text-[11px] text-muted text-right leading-tight" title={where || undefined}>
                            On: {where || 'another role'}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="pt-2 text-[11px] text-muted">
                Matched on skill pool and role title.{' '}
                <Link to={poolLink} className="text-primary font-semibold hover:underline">
                  See the full {pools[0] ? `${poolLabel(pools[0])} pool` : 'database'}
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
