import { Prisma, type PrismaClient } from '@prisma/client';
import type { Balance } from '../../domain/debtSimplifier';

/**
 * Balances derived from the ledger (ADR-0002); nothing is stored.
 * balance = paid for others - owed + settlements sent - settlements received
 * Positive means the group owes this member money.
 */
export async function groupBalances(prisma: PrismaClient | Prisma.TransactionClient, groupId: string): Promise<Balance[]> {
  const rows = await prisma.$queryRaw<{ userId: string; amount: bigint }[]>`
    SELECT m."userId" AS "userId",
      COALESCE(paid.total, 0) - COALESCE(owed.total, 0)
        + COALESCE(sent.total, 0) - COALESCE(received.total, 0) AS amount
    FROM "Membership" m
    LEFT JOIN (
      SELECT "paidById" AS uid, SUM("amountMinor") AS total FROM "Expense"
      WHERE "groupId" = ${groupId} GROUP BY "paidById"
    ) paid ON paid.uid = m."userId"
    LEFT JOIN (
      SELECT s."userId" AS uid, SUM(s."amountMinor") AS total
      FROM "ExpenseSplit" s JOIN "Expense" e ON e.id = s."expenseId"
      WHERE e."groupId" = ${groupId} GROUP BY s."userId"
    ) owed ON owed.uid = m."userId"
    LEFT JOIN (
      SELECT "fromUserId" AS uid, SUM("amountMinor") AS total FROM "Settlement"
      WHERE "groupId" = ${groupId} AND status IN ('PAID', 'RECORDED_CASH') GROUP BY "fromUserId"
    ) sent ON sent.uid = m."userId"
    LEFT JOIN (
      SELECT "toUserId" AS uid, SUM("amountMinor") AS total FROM "Settlement"
      WHERE "groupId" = ${groupId} AND status IN ('PAID', 'RECORDED_CASH') GROUP BY "toUserId"
    ) received ON received.uid = m."userId"
    WHERE m."groupId" = ${groupId}
    ORDER BY m."joinedAt"
  `;
  return rows.map((r) => ({ userId: r.userId, amountMinor: Number(r.amount) }));
}
