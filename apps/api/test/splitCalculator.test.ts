import { describe, expect, it } from 'vitest';
import {
  splitByPercentage,
  splitByShares,
  splitEqually,
  splitExactly,
} from '../src/domain/splitCalculator';

const total = (shares: { amountMinor: number }[]) => shares.reduce((sum, s) => sum + s.amountMinor, 0);

describe('splitEqually', () => {
  it('gives leftover cents to the first members so the total is exact', () => {
    const shares = splitEqually(10000, ['a', 'b', 'c']);
    expect(shares.map((s) => s.amountMinor)).toEqual([3334, 3333, 3333]);
    expect(total(shares)).toBe(10000);
  });
});

describe('splitByShares', () => {
  it('weights by shares', () => {
    const shares = splitByShares(9000, [
      { userId: 'a', shares: 2 },
      { userId: 'b', shares: 1 },
    ]);
    expect(shares).toEqual([
      { userId: 'a', amountMinor: 6000 },
      { userId: 'b', amountMinor: 3000 },
    ]);
  });
});

describe('splitByPercentage', () => {
  it('splits by percentage and keeps the exact total', () => {
    const shares = splitByPercentage(9999, [
      { userId: 'a', percent: 50 },
      { userId: 'b', percent: 25 },
      { userId: 'c', percent: 25 },
    ]);
    expect(total(shares)).toBe(9999);
  });

  it('rejects percentages that do not sum to 100', () => {
    expect(() => splitByPercentage(1000, [{ userId: 'a', percent: 90 }])).toThrow(/sum to 100/);
  });
});

describe('splitExactly', () => {
  it('rejects amounts that do not add up to the total', () => {
    expect(() =>
      splitExactly(1000, [
        { userId: 'a', amountMinor: 600 },
        { userId: 'b', amountMinor: 300 },
      ]),
    ).toThrow(/summing to 1000/);
  });
});
