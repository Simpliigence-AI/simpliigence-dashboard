/**
 * The account list behind a ticket's Account picker.
 *
 * Two tables hold customer names and neither is a superset of the other:
 *
 *   `accounts`            Account Management. `tickets.account_id` has an FK to
 *                         it, and `desk-inbound` writes those ids when it can
 *                         route an inbound email by sender domain.
 *   `concierge_accounts`  The Concierge Overview tab. Separate id namespace —
 *                         these ids are NOT valid for `tickets.account_id`.
 *
 * The picker used to offer only the first, which is why managed-services
 * customers that exist solely as concierge accounts (Protectolite, Integrity
 * Together LLC, Sumedco…) could not be selected at all.
 *
 * So the list is the union of both, active only, deduped case-insensitively by
 * name with the Account Management row winning — it is the one that carries an
 * id the FK accepts. Picking a concierge-only account stores the NAME and
 * leaves `account_id` null, which costs nothing here: every rollup on the
 * Concierge page (ticket groups, EOM billing) groups by `tickets.account`.
 */
import { useMemo } from 'react';
import { useAccountStore } from '../store/useAccountStore';
import { useConciergeAccountsStore } from '../store/useConciergeAccountsStore';

export interface TicketAccountOption {
  /** Encoded so one <Select> can carry both namespaces — see `resolveTicketAccount`. */
  value: string;
  label: string;
}

export interface ResolvedTicketAccount {
  account: string | null;
  accountId: string | null;
}

/** `acct:<id>` for an Account Management row, `name:<name>` for a concierge-only one. */
const ACCT = 'acct:';
const NAME = 'name:';

const key = (name: string) => name.trim().toLowerCase();

/** The option value for a ticket's current account, or '' when it has none. */
export function ticketAccountValue(ticket: { account?: string | null; accountId?: string | null }): string {
  if (ticket.accountId) return `${ACCT}${ticket.accountId}`;
  if (ticket.account && ticket.account.trim()) return `${NAME}${ticket.account.trim()}`;
  return '';
}

/**
 * Turn a selected option value back into the two columns a ticket stores.
 * `accountNameById` resolves an `acct:` value to its display name.
 */
export function resolveTicketAccount(
  value: string,
  accountNameById: Map<string, string>,
): ResolvedTicketAccount {
  if (!value) return { account: null, accountId: null };
  if (value.startsWith(ACCT)) {
    const id = value.slice(ACCT.length);
    return { account: accountNameById.get(id) ?? null, accountId: id };
  }
  if (value.startsWith(NAME)) {
    return { account: value.slice(NAME.length) || null, accountId: null };
  }
  // Legacy: a bare Account Management id, from a build before this encoding.
  return { account: accountNameById.get(value) ?? null, accountId: value };
}

/**
 * Merged, alphabetised option list.
 *
 * `currentAccount` / `currentAccountId` keep the ticket's existing account in
 * the list even after it goes inactive or dormant, so opening an old ticket
 * never silently blanks its account just because the dropdown stopped offering
 * it. They are passed as two scalars rather than an object so the memo below
 * is not invalidated by a fresh object on every render.
 */
export function useTicketAccountOptions(
  currentAccount?: string | null,
  currentAccountId?: string | null,
): { options: TicketAccountOption[]; accountNameById: Map<string, string> } {
  const accounts = useAccountStore((s) => s.accounts);
  const conciergeAccounts = useConciergeAccountsStore((s) => s.accounts);

  const accountNameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const options = useMemo<TicketAccountOption[]>(() => {
    const byKey = new Map<string, TicketAccountOption>();

    for (const a of accounts) {
      if (a.status !== 'active') continue;
      byKey.set(key(a.name), { value: `${ACCT}${a.id}`, label: a.name });
    }
    for (const c of conciergeAccounts) {
      if (c.isDormant) continue;
      const k = key(c.name);
      if (byKey.has(k)) continue;              // Account Mgmt row wins — it has a usable id.
      byKey.set(k, { value: `${NAME}${c.name.trim()}`, label: c.name });
    }

    // Whatever the ticket already points at stays selectable.
    const currentValue = ticketAccountValue({ account: currentAccount, accountId: currentAccountId });
    if (currentValue) {
      const currentName = (currentAccountId ? accountNameById.get(currentAccountId) : null)
        ?? currentAccount ?? '';
      const k = key(currentName);
      const existing = k ? byKey.get(k) : undefined;
      if (existing) {
        // Same account, different encoding (e.g. it now has an Account Mgmt
        // row). Keep the ticket's own value so the <Select> stays controlled.
        if (existing.value !== currentValue) {
          byKey.set(k, { value: currentValue, label: existing.label });
        }
      } else if (currentName) {
        byKey.set(k, { value: currentValue, label: `${currentName} (inactive)` });
      }
    }

    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [accounts, conciergeAccounts, currentAccount, currentAccountId, accountNameById]);

  return { options, accountNameById };
}
