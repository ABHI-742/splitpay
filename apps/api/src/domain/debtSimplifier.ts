/**
 * Greedy min-cash-flow debt simplification (docs/architecture.md, section 5).
 * Balances are in integer minor units: positive = is owed money, negative = owes money.
 * Produces at most n - 1 transfers for n members with a non-zero balance.
 */

export interface Balance {
  userId: string;
  amountMinor: number;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
}

export function simplifyDebts(balances: Balance[]): Transfer[] {
  const total = balances.reduce((sum, b) => sum + b.amountMinor, 0);
  if (total !== 0) {
    throw new Error(`Balances must sum to zero, got ${total}`);
  }

  const creditors = balances
    .filter((b) => b.amountMinor > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.userId.localeCompare(b.userId));
  const debtors = balances
    .filter((b) => b.amountMinor < 0)
    .map((b) => ({ userId: b.userId, amountMinor: -b.amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.userId.localeCompare(b.userId));

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;

  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c];
    const debtor = debtors[d];
    const amountMinor = Math.min(creditor.amountMinor, debtor.amountMinor);

    transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountMinor });
    creditor.amountMinor -= amountMinor;
    debtor.amountMinor -= amountMinor;

    if (creditor.amountMinor === 0) c += 1;
    if (debtor.amountMinor === 0) d += 1;
  }

  return transfers;
}
