/**
 * One definition of what a ticket status means.
 *
 * `tickets.status` is free text. The UI writes five capitalised values —
 * 'Open' | 'On Hold' | 'Escalated' | 'Resolved' | 'Closed' — but there is no
 * check constraint or enum behind it, and rows synced from Zoho Desk arrive
 * with Zoho's own casing ('OPEN', 'ON HOLD'). Comparing with `status === 'Open'`
 * therefore both misses case variants and silently excludes On Hold and
 * Escalated, which is how the same "open tickets" question got three different
 * answers on the same page.
 *
 * Buckets:
 *   open    — open | on hold | escalated  (i.e. still needs someone)
 *   closed  — resolved | closed
 *   unknown — anything else, reported as unknown rather than folded into one
 *             of the two, so a new status value shows up instead of hiding.
 *
 * KEEP IN SYNC: `supabase/functions/concierge-ai-query/index.ts` carries its
 * own copy of this bucketing. A Deno edge function cannot import from `src/`,
 * so the duplication is unavoidable — but if the sets here change, that file
 * has to change too, or the AI's counts will drift from the dashboard's again.
 */

export type TicketStatusBucket = 'open' | 'closed' | 'unknown';

const OPEN_STATUSES = new Set(['open', 'on hold', 'escalated']);
const CLOSED_STATUSES = new Set(['resolved', 'closed']);

/** Trim, lowercase, and collapse runs of whitespace/underscore/hyphen to a
 *  single space. The only normalisation anyone should be doing — and it must
 *  stay byte-for-byte equivalent to `statusBucket` in
 *  supabase/functions/concierge-ai-query/index.ts, which does the same, so
 *  Zoho's 'On-Hold' / 'on_hold' bucket as On Hold on both sides instead of
 *  counting as open in the AI digest and as unknown on the dashboard. */
export function normalizeTicketStatus(status: string | null | undefined): string {
  return (status ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

export function ticketStatusBucket(status: string | null | undefined): TicketStatusBucket {
  const s = normalizeTicketStatus(status);
  if (OPEN_STATUSES.has(s)) return 'open';
  if (CLOSED_STATUSES.has(s)) return 'closed';
  return 'unknown';
}

/** Still needs someone: Open, On Hold or Escalated. */
export function isTicketOpen(status: string | null | undefined): boolean {
  return ticketStatusBucket(status) === 'open';
}

/** Done: Resolved or Closed. */
export function isTicketClosed(status: string | null | undefined): boolean {
  return ticketStatusBucket(status) === 'closed';
}

/** Case/whitespace-insensitive match against one exact status, for the places
 *  that legitimately want a single value ("N On Hold") rather than a bucket. */
export function isTicketStatus(status: string | null | undefined, canonical: string): boolean {
  return normalizeTicketStatus(status) === normalizeTicketStatus(canonical);
}
