/** Account Management types — accounts, sales/delivery connects, action items. */

export type AccountStatus = 'active' | 'inactive' | 'churned';

export interface Account {
  id: string;
  name: string;
  salesOwnerEmail: string | null;
  deliveryOwnerEmail: string | null;
  status: AccountStatus;
  industry: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type ConnectType = 'sales' | 'delivery';

export interface AccountConnect {
  id: string;
  accountId: string;
  connectType: ConnectType;
  meetingDate: string;          // YYYY-MM-DD
  attendees: string;
  discussion: string;
  outcome: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface AccountActionItem {
  id: string;
  accountId: string;
  /** Optional FK to the connect this action came out of. */
  connectId: string | null;
  title: string;
  description: string;
  ownerEmail: string | null;
  dueDate: string | null;       // YYYY-MM-DD
  status: ActionStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** SLA threshold (days) — if last connect older than this, account is "stale". */
export const STALE_CONNECT_DAYS = 30;
