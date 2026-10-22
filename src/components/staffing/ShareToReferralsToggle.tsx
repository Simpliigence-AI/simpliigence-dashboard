/**
 * "Share to referrals" checkbox for a requisition.
 *
 * Ticked requisitions (and every requisition on an internal account —
 * India "Internal" / US "Simpliigence") are published to the Careers →
 * Refer a friend page on the Simpliigence Hub intranet while they're open.
 * The Hub reads them through the `referral_jobs()` RPC (migration 038),
 * which exposes only title / location / positions / JD — never the client.
 */
import { Megaphone } from 'lucide-react';

/** Internal accounts auto-publish to referrals. Keep in sync with referral_jobs(). */
export function isInternalAccountName(name?: string | null): boolean {
  const n = (name || '').trim().toLowerCase();
  return n.startsWith('internal') || n.startsWith('simpliigence');
}

interface Props {
  checked: boolean;
  internal?: boolean;
  onChange: (next: boolean) => void;
  compact?: boolean;
}

export function ShareToReferralsToggle({ checked, internal, onChange, compact }: Props) {
  const on = checked || !!internal;
  const title = internal
    ? 'Internal role — always posted to the Hub referral page while open'
    : on
      ? 'Posted to the Hub referral page while open. Untick to remove.'
      : 'Tick to post this role on the Hub referral page (client name is never shown)';
  return (
    <label
      title={title}
      className={`inline-flex items-center gap-1.5 select-none ${internal ? 'cursor-default' : 'cursor-pointer'} ${compact ? 'text-[10px] mt-0.5' : 'text-sm'} ${on ? 'text-emerald-700' : 'text-muted'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={internal}
        onChange={(e) => onChange(e.target.checked)}
        className={compact ? 'h-3 w-3' : 'h-4 w-4'}
      />
      <Megaphone size={compact ? 10 : 14} aria-hidden />
      <span>{internal ? 'Share to referrals (auto · internal)' : 'Share to referrals'}</span>
    </label>
  );
}
