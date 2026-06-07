/**
 * Tiny avatar circle. Renders the uploaded image when avatarUrl is set,
 * otherwise renders initials on a deterministic colored background.
 *
 *  - `email` is used as the deterministic colour seed when no name is given
 *  - `name` (full or first) drives the initials
 *  - `avatarUrl` is the path within the user-avatars Storage bucket, or a
 *    full https URL. We resolve bucket paths to the public URL inline so
 *    the consumer doesn't have to know about Storage.
 */
import { useMemo } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

const COLORS = [
  'bg-sky-500',     'bg-emerald-500', 'bg-amber-500',  'bg-rose-500',
  'bg-violet-500',  'bg-fuchsia-500', 'bg-teal-500',   'bg-orange-500',
  'bg-indigo-500',  'bg-cyan-500',    'bg-lime-600',   'bg-pink-500',
];

function hashIdx(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h) % mod;
}

function initials(name: string | null | undefined, email: string): string {
  const src = (name && name.trim()) || email.split('@')[0] || '';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function resolveAvatarUrl(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) return avatarUrl;
  // Otherwise it's a storage object path inside user-avatars
  const { data } = supabase.storage.from('user-avatars').getPublicUrl(avatarUrl);
  return data?.publicUrl || null;
}

export function UserAvatar({ email, name, avatarUrl, size = 28, className = '' }: Props) {
  const resolvedUrl = useMemo(() => resolveAvatarUrl(avatarUrl), [avatarUrl]);
  const ini = useMemo(() => initials(name, email), [name, email]);
  const color = useMemo(() => COLORS[hashIdx((email || ini).toLowerCase(), COLORS.length)], [email, ini]);

  const px = `${size}px`;
  if (resolvedUrl) {
    return (
      <img
        src={resolvedUrl}
        alt={name || email}
        style={{ width: px, height: px }}
        className={`rounded-full object-cover ring-1 ring-slate-200 flex-shrink-0 ${className}`}
        loading="lazy"
      />
    );
  }
  // Initials fallback
  const fontSize = Math.max(10, Math.round(size * 0.42));
  return (
    <span
      style={{ width: px, height: px, fontSize: `${fontSize}px` }}
      className={`rounded-full flex items-center justify-center text-white font-bold ${color} flex-shrink-0 ${className}`}
      title={name || email}
      aria-label={name || email}
    >
      {ini}
    </span>
  );
}
