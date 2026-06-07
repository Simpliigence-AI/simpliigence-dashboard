/** A named individual at a client account — separate from internal users and
 *  from candidates. Used by the Client Contacts tab on each account to track
 *  relationship-management touch-points (last call, gifts, etc.).
 *
 *  Lives in its own file (not accountMgmt.ts) so unrelated linter passes
 *  on accountMgmt.ts don't strip it.
 */
export interface AccountClientContact {
  id: string;
  accountId: string;
  name: string;
  email: string;
  phone: string;
  /** ISO date (YYYY-MM-DD) when we last had a meaningful touch with this contact. */
  lastContactAt: string | null;
  /** Free-text — what was sent ("Diwali hamper", "Single malt"). */
  gift: string;
  /** ISO date (YYYY-MM-DD) the gift was sent. */
  giftDate: string | null;
  /** Optional freeform notes. */
  notes: string;
  createdAt: string;
  updatedAt: string;
}
