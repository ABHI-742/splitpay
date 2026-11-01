import { describe, expect, it } from 'vitest';
import { simplifyDebts, type Balance, type Transfer } from '../src/domain/debtSimplifier';

function applyTransfers(balances: Balance[], transfers: Transfer[]): Map<string, number> {
  const result = new Map(balances.map((b) => [b.userId, b.amountMinor]));
  for (const t of transfers) {
    result.set(t.fromUserId, (result.get(t.fromUserId) ?? 0) + t.amountMinor);
    result.set(t.toUserId, (result.get(t.toUserId) ?? 0) - t.amountMinor);
  }
  return result;
}

describe('simplifyDebts', () => {
  it('settles a simple two-person debt with one transfer', () => {
    const transfers = simplifyDebts([
      { userId: 'alice', amountMinor: 3000 },
      { userId: 'bob', amountMinor: -3000 },
    ]);
    expect(transfers).toEqual([{ fromUserId: 'bob', toUserId: 'alice', amountMinor: 3000 }]);
  });

  it('uses at most n - 1 transfers and zeroes every balance', () => {
    const balances: Balance[] = [
      { userId: 'a', amountMinor: 5000 },
      { userId: 'b', amountMinor: 2500 },
      { userId: 'c', amountMinor: -1000 },
      { userId: 'd', amountMinor: -2000 },
      { userId: 'e', amountMinor: -3500 },
      { userId: 'f', amountMinor: -1000 },
    ];
    const transfers = simplifyDebts(balances);

    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1);
    for (const amount of applyTransfers(balances, transfers).values()) {
      expect(amount).toBe(0);
    }
  });

  it('returns no transfers when everyone is settled', () => {
    expect(simplifyDebts([{ userId: 'a', amountMinor: 0 }])).toEqual([]);
  });

  it('rejects balances that do not sum to zero', () => {
    expect(() => simplifyDebts([{ userId: 'a', amountMinor: 100 }])).toThrow(/sum to zero/);
  });
});
