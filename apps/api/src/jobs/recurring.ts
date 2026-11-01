import type { PrismaClient } from '@prisma/client';
import { type Job, type JobsOptions, Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { EventPublisher } from '../lib/events';
import { createExpense } from '../modules/expenses/expenses.service';
import { memberIds } from '../modules/groups/membership';

export const RECURRING_QUEUE = 'recurring-expenses';
export const RECURRING_DLQ = 'recurring-expenses-dlq';

/**
 * Retry policy for recurring runs: 5 attempts with exponential backoff (30s, 1m, 2m, 4m).
 * Retrying is safe because each run is idempotent per (rule, date). A job that fails every
 * attempt is copied to the dead-letter queue (RECURRING_DLQ) for inspection and replay.
 */
export const RECURRING_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export interface DeadLetter {
  recurringId: string;
  failedJobId: string | undefined;
  attemptsMade: number;
  error: string;
  failedAt: string;
}

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
      { name: 'create-recurring-expense', data: { recurringId }, opts: RECURRING_JOB_OPTIONS },
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

export interface RecurringWorker {
  worker: Worker;
  deadLetters: Queue<DeadLetter>;
  close(): Promise<void>;
}

/** True once BullMQ will not retry the job again. */
export function isFinalFailure(job: Job): boolean {
  return job.attemptsMade >= (job.opts.attempts ?? 1);
}

export function startRecurringWorker(connection: Redis, prisma: PrismaClient, events: EventPublisher): RecurringWorker {
  const dlqConnection = connection.duplicate();
  const deadLetters = new Queue<DeadLetter>(RECURRING_DLQ, { connection: dlqConnection });
  const worker = new Worker(
    RECURRING_QUEUE,
    async (job) => {
      const runAt = new Date(job.timestamp);
      return runRecurringExpense(prisma, events, job.data.recurringId as string, runAt);
    },
    { connection },
  );
  worker.on('failed', (job, err) => {
    if (!job || !isFinalFailure(job)) return;
    const letter: DeadLetter = {
      recurringId: job.data.recurringId,
      failedJobId: job.id,
      attemptsMade: job.attemptsMade,
      error: err.message,
      failedAt: new Date().toISOString(),
    };
    deadLetters.add('dead-letter', letter, { removeOnComplete: false, removeOnFail: false }).catch((e) => {
      console.error('could not write to the dead-letter queue', e);
    });
  });
  return {
    worker,
    deadLetters,
    async close() {
      await worker.close();
      await deadLetters.close();
      dlqConnection.disconnect();
    },
  };
}

/**
 * Moves every dead letter back onto the recurring queue with the normal retry policy.
 * Run with `npm run dlq:replay` once the cause (database outage, bad rule) is fixed.
 */
export async function replayDeadLetters(connection: Redis): Promise<number> {
  const deadLetters = new Queue<DeadLetter>(RECURRING_DLQ, { connection });
  const recurringConnection = connection.duplicate();
  const recurring = new Queue(RECURRING_QUEUE, { connection: recurringConnection });
  try {
    const letters = await deadLetters.getWaiting(0, -1);
    for (const letter of letters) {
      await recurring.add('create-recurring-expense', { recurringId: letter.data.recurringId }, RECURRING_JOB_OPTIONS);
      await letter.remove();
    }
    return letters.length;
  } finally {
    await recurring.close();
    await deadLetters.close();
    recurringConnection.disconnect();
  }
}
