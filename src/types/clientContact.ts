/** A named individual at a client account — separate from internal users and
 *  from candidates. Used by the Client Contacts tab on each account to track
 *  relationship-management touch-points (last call, gifts, etc.).
 *
 *  Lives in its own file (not accountMgmt.ts) so unrelated linter passes
 *  on accountMgmt.ts don't strip it.
 */
/** Relationship temperature with the contact — drives a colored chip in the UI. */
export type ClientContactRelationship = 'hot' | 'warm' | 'cold';

export const CLIENT_CONTACT_RELATIONSHIPS: ClientContactRelationship[] = ['hot', 'warm', 'cold'];

export const CLIENT_CONTACT_RELATIONSHIP_STYLES: Record<ClientContactRelationship, {
  label: string;
  bg: string;
  text: string;
  border: string;
}> = {
  hot:  { label: 'Hot',  bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200'    },
  warm: { label: 'Warm', bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200'  },
  cold: { label: 'Cold', bg: 'bg-sky-50',    text: 'text-sky-700',    border: 'border-sky-200'    },
};

export interface AccountClientContact {
  id: string;
  accountId: string;
  name: string;
  /** Job title at the client (free text, e.g. "VP Engineering"). */
  title: string;
  email: string;
  phone: string;
  /** Relationship temperature — null until set. */
  relationship: ClientContactRelationship | null;
  /** ISO date (YYYY-MM-DD) when we last had a meaningful touch with this contact. */
  lastContactAt: string | null;
  /** Free-text — what was sent ("Diwali hamper", "Single malt"). */
  gift: string;
  /** ISO date (YYYY-MM-DD) the gift was sent. */
  giftDate: string | null;
  /** Optional freeform notes — rendered as a textarea below the row. */
  notes: string;
  /** 'manual' (typed by team) or 'salesforce' (synced from SF). Never null. */
  source: 'manual' | 'salesforce';
  /** SF Contact.Id when source='salesforce'; null otherwise. */
  salesforceId: string | null;
  createdAt: string;
  updatedAt: string;
}
