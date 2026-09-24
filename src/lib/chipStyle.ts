/**
 * Inline style for a coloured chip/badge whose background comes from data
 * (stage colours, leave-type colours …). Picks white or navy text so the
 * label stays readable on any background — white on '#e2e8f0' or amber was
 * unreadable in both themes.
 */
import type { CSSProperties } from 'react';

function luminance(hex: string): number | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White text if it clears 3:1 on `bg`, otherwise dark navy. */
export function readableOn(bg: string | undefined | null): string {
  const L = bg ? luminance(bg) : null;
  if (L === null) return '#ffffff';
  const whiteContrast = 1.05 / (L + 0.05);
  return whiteContrast >= 3 ? '#ffffff' : '#0f1b2d';
}

export function chipStyle(bg: string | undefined | null): CSSProperties {
  return { background: bg ?? undefined, color: readableOn(bg) };
}
