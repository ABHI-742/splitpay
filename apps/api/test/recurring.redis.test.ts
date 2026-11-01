import type { PrismaClient } from '@prisma/client';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BullRecurringScheduler,
  type DeadLetter,
  RECURRING_DLQ,
  RECURRING_JOB_OPTIONS,
  RECURRING_QUEUE,
  replayDeadLetters,
  startRecurringWorker,
} from '../src/jobs/recurring';
import { MemoryEventPublisher } from '../src/lib/events';
import { buildDeps, config, groupWith, prisma, register, resetDatabase } from './helpers';

/** BullMQ against a real Redis (TEST_REDIS_URL). */
describe('BullMQ recurring scheduler and worker', () => {
  const connections: Redis[] = [];
  const redis = () => {
    const r = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    connections.push(r);
    return r;
  };

  afterAll(async () => {
    for (const r of connections) r.disconnect();
    await prisma.$disconnect();
  });

  it('registers a job scheduler and the worker creates the expense', async () => {
    await resetDatabase();
    const queue = new Queue(RECURRING_QUEUE, { connection: redis() });
    await queue.obliterate({ force: true });

    const scheduler = new BullRecurringScheduler(redis());
    const { app } = buildDeps({ recurring: scheduler });
    const [alice, bob] = [await register(app, 'Alice'), await register(app, 'Bob')];
    const groupId = await groupWith(app, [alice, bob], 'Apartment');
    const rule = await request(app)
      .post(`/groups/${groupId}/recurring`)
      .set(alice.auth)
      .send({ description: 'Internet', amountMinor: 6000, paidById: alice.id, cron: '0 9 1 * *' })
      .expect(201);

    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toContain(rule.body.id);

    // Run the job now instead of waiting for the 1st of the month.
    const events = new MemoryEventPublisher();
    const { worker, close } = startRecurringWorker(redis(), prisma, events);
    const done = new Promise((resolve) => worker.once('completed', (_job, result) => resolve(result)));
    await queue.add('create-recurring-expense', { recurringId: rule.body.id });
    await expect(done).resolves.toBe('created');
    expect(await prisma.expense.count({ where: { groupId } })).toBe(1);
    expect(events.events[0]).toMatchObject({ type: 'expense.created', groupId });

    await scheduler.unschedule(rule.body.id);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).not.toContain(rule.body.id);
    await close();
    await scheduler.close();
    await queue.close();
  });

  it('schedules recurring jobs with retries and exponential backoff', async () => {
    const queue = new Queue(RECURRING_QUEUE, { connection: redis() });
    await queue.obliterate({ force: true });
    const scheduler = new BullRecurringScheduler(redis());
    await scheduler.schedule('rule-with-retries', '0 9 1 * *');

    const [next] = await queue.getDelayed();
    expect(next.opts.attempts).toBe(5);
    expect(next.opts.backoff).toEqual({ type: 'exponential', delay: 30_000 });
    expect(RECURRING_JOB_OPTIONS.attempts).toBe(5);

    await scheduler.unschedule('rule-with-retries');
    await scheduler.close();
    await queue.close();
  });

  it('retries a failing job, dead-letters it after the last attempt, and replays it', async () => {
    await resetDatabase();
    const queue = new Queue(RECURRING_QUEUE, { connection: redis() });
    const dlq = new Queue<DeadLetter>(RECURRING_DLQ, { connection: redis() });
    await queue.obliterate({ force: true });
    await dlq.obliterate({ force: true });

    const { app } = buildDeps();
    const [alice, bob] = [await register(app, 'Alice'), await register(app, 'Bob')];
    const groupId = await groupWith(app, [alice, bob], 'Flat');
    const rule = await request(app)
      .post(`/groups/${groupId}/recurring`)
      .set(alice.auth)
      .send({ description: 'Rent', amountMinor: 120000, paidById: alice.id, cron: '0 9 1 * *' })
      .expect(201);

    // Simulate a database outage: every attempt throws.
    let calls = 0;
    const brokenPrisma = {
      recurringExpense: {
        findUnique: async () => {
          calls += 1;
          throw new Error('database unavailable');
        },
      },
    } as unknown as PrismaClient;
    const broken = startRecurringWorker(redis(), brokenPrisma, new MemoryEventPublisher());
    const queueEvents = new QueueEvents(RECURRING_DLQ, { connection: redis() });
    await queueEvents.waitUntilReady();
    const deadLettered = new Promise((resolve) => queueEvents.once('waiting', resolve));

    await queue.add(
      'create-recurring-expense',
      { recurringId: rule.body.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 20 } },
    );
    await deadLettered;
    await broken.close();

    expect(calls).toBe(3);
    const [letter] = await dlq.getWaiting();
    expect(letter.data).toMatchObject({ recurringId: rule.body.id, attemptsMade: 3, error: 'database unavailable' });
    expect(await prisma.expense.count({ where: { groupId } })).toBe(0);

    // The outage is over: replay the dead letter through a healthy worker.
    const healthy = startRecurringWorker(redis(), prisma, new MemoryEventPublisher());
    const done = new Promise((resolve) => healthy.worker.once('completed', (_job, result) => resolve(result)));
    expect(await replayDeadLetters(redis())).toBe(1);
    await expect(done).resolves.toBe('created');
    expect(await dlq.getWaitingCount()).toBe(0);
    expect(await prisma.expense.count({ where: { groupId } })).toBe(1);

    await healthy.close();
    await queueEvents.close();
    await dlq.close();
    await queue.close();
  });
});
