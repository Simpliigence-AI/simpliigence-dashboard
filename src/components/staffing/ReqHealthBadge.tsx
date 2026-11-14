/**
 * Colour language for requisition health, shared by the India Demand table, split
 * view and filter chips so red / amber / green mean the same thing everywhere.
 * Every state pairs its colour with an icon and a text label; colour never carries
 * the meaning alone.
 */
import type { ReqHealthInfo } from '../../lib/reqHealth';
import { HEALTH_META } from '../../lib/reqHealthStyle';

export function ReqHealthBadge({ info, className = '' }: { info: ReqHealthInfo | undefined; className?: string }) {
  if (!info) return null;
  const main = info.health !== 'ok' ? HEALTH_META[info.health] : null;
  // An overdue role that is also interviewing shows both: red for the date, green for the progress.
  const alsoFast = info.interviewing && info.health !== 'fast';
  if (!main && !alsoFast) return null;
  const Fast = HEALTH_META.fast.icon;
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      {main && (
        <span title={info.detail}
          className={`inline-flex items-center gap-1 text-[11px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap ${main.badge}`}>
          <main.icon size={12} aria-hidden="true" /> {info.label}
        </span>
      )}
      {alsoFast && (
        <span title="A candidate is at interview stage or beyond."
          className={`inline-flex items-center gap-1 text-[11px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap ${HEALTH_META.fast.badge}`}>
          <Fast size={12} aria-hidden="true" /> Interviewing
        </span>
      )}
    </span>
  );
}
