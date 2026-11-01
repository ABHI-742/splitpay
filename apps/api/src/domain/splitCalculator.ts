/**
 * Split an expense total (integer minor units) between members.
 * Leftover cents are given one at a time to members in the order provided,
 * so splits always sum exactly to the total (ADR-0001).
 */

export interface Share {
  userId: string;
  amountMinor: number;
}

function assertPositiveInteger(totalMinor: number): void {
  if (!Number.isInteger(totalMinor) || totalMinor <= 0) {
    throw new Error('Total must be a positive integer number of minor units');
  }
}

function byWeights(totalMinor: number, weights: { userId: string; weight: number }[]): Share[] {
  assertPositiveInteger(totalMinor);
  const weightSum = weights.reduce((sum, w) => sum + w.weight, 0);
  if (weights.length === 0 || weightSum <= 0 || weights.some((w) => w.weight < 0)) {
    throw new Error('Weights must be non-negative and sum to more than zero');
  }

  const shares = weights.map((w) => ({
    userId: w.userId,
    amountMinor: Math.floor((totalMinor * w.weight) / weightSum),
  }));
  let remainder = totalMinor - shares.reduce((sum, s) => sum + s.amountMinor, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % shares.length) {
    if (weights[i].weight > 0) {
      shares[i].amountMinor += 1;
      remainder -= 1;
    }
  }
  return shares;
}

export function splitEqually(totalMinor: number, userIds: string[]): Share[] {
  return byWeights(
    totalMinor,
    userIds.map((userId) => ({ userId, weight: 1 })),
  );
}

export function splitByShares(totalMinor: number, shares: { userId: string; shares: number }[]): Share[] {
  return byWeights(
    totalMinor,
    shares.map((s) => ({ userId: s.userId, weight: s.shares })),
  );
}

export function splitByPercentage(
  totalMinor: number,
  percents: { userId: string; percent: number }[],
): Share[] {
  const sum = percents.reduce((acc, p) => acc + p.percent, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`Percentages must sum to 100, got ${sum}`);
  }
  return byWeights(
    totalMinor,
    percents.map((p) => ({ userId: p.userId, weight: p.percent })),
  );
}

export function splitExactly(totalMinor: number, amounts: Share[]): Share[] {
  assertPositiveInteger(totalMinor);
  const sum = amounts.reduce((acc, a) => acc + a.amountMinor, 0);
  if (sum !== totalMinor || amounts.some((a) => !Number.isInteger(a.amountMinor) || a.amountMinor < 0)) {
    throw new Error(`Exact amounts must be non-negative integers summing to ${totalMinor}, got ${sum}`);
  }
  return amounts.map((a) => ({ ...a }));
}
