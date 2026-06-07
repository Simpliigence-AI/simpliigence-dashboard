/**
 * Renders an avatar + name for a user identified by email. Looks the
 * profile up in useAuthStore.directory; falls back to a friendly name
 * derived from the email's local part when the user isn't in the
 * directory yet.
 *
 *  - `email` is the only required prop
 *  - `compact` (default false) renders just the avatar with the name in a tooltip
 *  - `nameSize` controls the font size class on the name span
 *  - `showEmail` (default false) renders the email as a small grey line under the name
 */
import { useAuthStore, lookupProfile } from '../store/useAuthStore';
import { UserAvatar } from './UserAvatar';

interface Props {
  email: string | null | undefined;
  /** Avatar diameter in px. Default 28. */
  avatarSize?: number;
  /** Render only the avatar (name in title tooltip). */
  compact?: boolean;
  /** Tailwind text-size class for the name. Default 'text-sm'. */
  nameSize?: string;
  /** Show the email as a small grey line under the name. */
  showEmail?: boolean;
  className?: string;
  /** Force a specific layout direction. */
  layout?: 'row' | 'col';
}

export function TaIdentity({
  email,
  avatarSize = 28,
  compact = false,
  nameSize = 'text-sm',
  showEmail = false,
  className = '',
  layout = 'row',
}: Props) {
  const directory = useAuthStore((s) => s.directory);
  if (!email) {
    return <span className={`text-slate-400 italic ${nameSize} ${className}`}>—</span>;
  }
  const profile = lookupProfile(email, directory);
  const displayName = profile.fullName || profile.email;
  const firstName = (profile.fullName || profile.email).split(/\s+/)[0];

  if (compact) {
    return (
      <span title={displayName} className={`inline-flex ${className}`}>
        <UserAvatar email={profile.email} name={profile.fullName} avatarUrl={profile.avatarUrl} size={avatarSize} />
      </span>
    );
  }

  const wrapperClasses = layout === 'col'
    ? 'inline-flex flex-col items-center gap-1'
    : 'inline-flex items-center gap-2 min-w-0';

  return (
    <span className={`${wrapperClasses} ${className}`}>
      <UserAvatar email={profile.email} name={profile.fullName} avatarUrl={profile.avatarUrl} size={avatarSize} />
      <span className="min-w-0">
        <span className={`block font-bold text-slate-900 truncate ${nameSize}`}>{firstName}</span>
        {showEmail && (
          <span className="block text-[10px] text-slate-400 truncate">{profile.email}</span>
        )}
      </span>
    </span>
  );
}
