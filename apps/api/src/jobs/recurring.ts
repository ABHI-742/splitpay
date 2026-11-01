import type { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { EventPublisher } from '../lib/events';
import { createExpense } from '../modules/expenses/expenses.service';
import { memberIds } from '../modules/groups/membership';

export const RECURRING_QUEUE = 'recurring-expenses';

/** Keeps BullMQ's repeatable jobs in sync with RecurringExpense rows. */
export interface RecurringScheduler {
  schedule(recurringId: string, cron: string): Promise<void>;
  unschedule(recurringId: string): Promise<void>;
}

export class BullRecurringScheduler implements RecurringScheduler {
  private readonly queue: Queue;

  constructor(connection: Redis) {
    this.queue = new Queue(RECURRING_QUEUE, { connection });
  }

  async schedule(recurringId: string, cron: string): Promise<void> {
    await this.queue.upsertJobScheduler(
      recurringId,
      { pattern: cron, tz: 'UTC' },
      { name: 'create-recurring-expense', data: { recurringId } },
    );
  }

  async unschedule(recurringId: string): Promise<void> {
    await this.queue.removeJobScheduler(recurringId);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export class MemoryRecurringScheduler implements RecurringScheduler {
  readonly schedules = new Map<string, string>();

  async schedule(recurringId: string, cron: string): Promise<void> {
    this.schedules.set(recurringId, cron);
  }

  async unschedule(recurringId: string): Promise<void> {
    this.schedules.delete(recurringId);
  }
}

/**
 * Creates this period's expense for a recurring rule, split equally between current members.
 * Idempotent per (rule, UTC date), so a retried or duplicated job creates nothing extra.
 */
export async function runRecurringExpense(
  prisma: PrismaClient,
  events: EventPublisher,
  recurringId: string,
  runAt: Date,
): Promise<'created' | 'duplicate' | 'inactive'> {
  const rule = await prisma.recurringExpense.findUnique({ where: { id: recurringId } });
  if (!rule || !rule.active) return 'inactive';
  const period = runAt.toISOString().slice(0, 10);
  const members = await memberIds(prisma, rule.groupId);
  if (!members.includes(rule.paidById)) return 'inactive';

  const { created } = await createExpense(prisma, events, rule.groupId, rule.paidById, {
    description: `${rule.description} (${period})`,
    amountMinor: rule.amountMinor,
    paidById: rule.paidById,
    incurredOn: new Date(`${period}T00:00:00Z`),
    idempotencyKey: `recurring:${rule.id}:${period}`,
    split: { method: 'EQUAL', userIds: members },
  });
  return created ? 'created' : 'duplicate';
}

export function startRecurringWorker(connection: Redis, prisma: PrismaClient, events: EventPublisher): Worker {
  return new Worker(
    RECURRING_QUEUE,
    async (job) => {
      const runAt = new Date(job.timestamp);
      return runRecurringExpense(prisma, events, job.data.recurringId as string, runAt);
    },
    { connection },
  );
}
