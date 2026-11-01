import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { BullRecurringScheduler, RECURRING_QUEUE, startRecurringWorker } from '../src/jobs/recurring';
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
    const worker = startRecurringWorker(redis(), prisma, events);
    const done = new Promise((resolve) => worker.once('completed', (_job, result) => resolve(result)));
    await queue.add('create-recurring-expense', { recurringId: rule.body.id });
    await expect(done).resolves.toBe('created');
    expect(await prisma.expense.count({ where: { groupId } })).toBe(1);
    expect(events.events[0]).toMatchObject({ type: 'expense.created', groupId });

    await scheduler.unschedule(rule.body.id);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).not.toContain(rule.body.id);
    await worker.close();
    await scheduler.close();
    await queue.close();
  });
});
