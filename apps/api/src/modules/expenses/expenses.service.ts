import type { Expense, PrismaClient } from '@prisma/client';
import { splitByPercentage, splitByShares, splitEqually, splitExactly, type Share } from '../../domain/splitCalculator';
import type { EventPublisher } from '../../lib/events';
import { HttpError } from '../../lib/http';
import { memberIds } from '../groups/membership';
import type { CreateExpenseInput } from './expenses.schema';

export function computeShares(input: CreateExpenseInput): Share[] {
  try {
    switch (input.split.method) {
      case 'EQUAL':
        return splitEqually(input.amountMinor, input.split.userIds);
      case 'EXACT':
        return splitExactly(input.amountMinor, input.split.amounts);
      case 'PERCENTAGE':
        return splitByPercentage(input.amountMinor, input.split.percents);
      case 'SHARES':
        return splitByShares(input.amountMinor, input.split.shares);
    }
  } catch (err) {
    throw new HttpError(422, (err as Error).message);
  }
}

/**
 * Creates an expense with its splits and activity in one transaction, then publishes the event.
 * Flow: docs/diagrams/activity-add-expense.md. Used by the API and the recurring-expense job.
 */
export async function createExpense(
  prisma: PrismaClient,
  events: EventPublisher,
  groupId: string,
  actorId: string,
  input: CreateExpenseInput,
): Promise<{ expense: Expense; created: boolean }> {
  if (input.idempotencyKey) {
    const existing = await prisma.expense.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.groupId !== groupId) throw new HttpError(409, 'Idempotency key already used');
      return { expense: existing, created: false };
    }
  }

  const shares = computeShares(input);
  const members = new Set(await memberIds(prisma, groupId));
  const outsiders = [input.paidById, ...shares.map((s) => s.userId)].filter((id) => !members.has(id));
  if (outsiders.length > 0) throw new HttpError(403, 'Payer and participants must be group members');
  if (new Set(shares.map((s) => s.userId)).size !== shares.length) {
    throw new HttpError(422, 'Each participant can appear only once');
  }

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        groupId,
        paidById: input.paidById,
        description: input.description,
        amountMinor: input.amountMinor,
        splitMethod: input.split.method,
        incurredOn: input.incurredOn,
        idempotencyKey: input.idempotencyKey,
        splits: { create: shares.filter((s) => s.amountMinor > 0) },
      },
    });
    await tx.activity.create({
      data: {
        groupId,
        actorId,
        type: 'expense.created',
        payload: { expenseId: created.id, description: created.description, amountMinor: created.amountMinor },
      },
    });
    return created;
  });

  await events.publish({ type: 'expense.created', groupId, expenseId: expense.id });
  return { expense, created: true };
}
