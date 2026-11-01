import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runRecurringExpense, type MemoryRecurringScheduler } from '../src/jobs/recurring';
import type { MemoryEventPublisher } from '../src/lib/events';
import { MemoryRateLimitStore } from '../src/lib/rateLimit';
import {
  buildDeps,
  equalExpense,
  type FakeStripeGateway,
  groupWith,
  prisma,
  register,
  resetDatabase,
  signedWebhook,
} from './helpers';

let ctx = buildDeps();
const app = () => ctx.app;
const events = () => ctx.deps.events as MemoryEventPublisher;

beforeEach(async () => {
  await resetDatabase();
  ctx = buildDeps();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auth', () => {
  it('registers, logs in and rejects bad passwords', async () => {
    await register(app(), 'Alice');
    await request(app()).post('/auth/login').send({ email: 'alice@example.com', password: 'nope' }).expect(401);
    const ok = await request(app()).post('/auth/login').send({ email: 'ALICE@example.com', password: 'correct horse battery' }).expect(200);
    const me = await request(app()).get('/auth/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body.email).toBe('alice@example.com');
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('rotates refresh tokens and revokes everything when an old one is reused', async () => {
    const cookieOf = (res: request.Response) =>
      String(([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('splitpay_refresh='))).split(';')[0];
    const registered = await request(app())
      .post('/auth/register')
      .send({ email: 'bob@example.com', name: 'Bob', password: 'correct horse battery' })
      .expect(201);
    const first = cookieOf(registered);

    const refreshed = await request(app()).post('/auth/refresh').set('Cookie', first).expect(200);
    const second = cookieOf(refreshed);
    expect(second).not.toBe(first);

    // Replaying the first (now revoked) token fails and revokes the newer session too.
    await request(app()).post('/auth/refresh').set('Cookie', first).expect(401);
    await request(app()).post('/auth/refresh').set('Cookie', second).expect(401);
  });

  it('requires a valid access token', async () => {
    await request(app()).get('/groups').expect(401);
    await request(app()).get('/groups').set('Authorization', 'Bearer not-a-jwt').expect(401);
  });

  it('rate limits login attempts', async () => {
    ctx = buildDeps({ rateLimitStore: new MemoryRateLimitStore() });
    for (let i = 0; i < 10; i++) {
      await request(app()).post('/auth/login').send({ email: 'x@example.com', password: 'y' }).expect(401);
    }
    await request(app()).post('/auth/login').send({ email: 'x@example.com', password: 'y' }).expect(429);
  });
});

describe('groups and expenses', () => {
  it('splits an expense and derives balances and the fewest transfers', async () => {
    const [alice, bob, carol] = [await register(app(), 'Alice'), await register(app(), 'Bob'), await register(app(), 'Carol')];
    const groupId = await groupWith(app(), [alice, bob, carol]);

    await request(app())
      .post(`/groups/${groupId}/expenses`)
      .set(alice.auth)
      .send(equalExpense(alice.id, [alice.id, bob.id, carol.id], 9000))
      .expect(201);
    await request(app())
      .post(`/groups/${groupId}/expenses`)
      .set(bob.auth)
      .send({ ...equalExpense(bob.id, [bob.id, carol.id], 1000, 'Taxi') })
      .expect(201);

    const group = await request(app()).get(`/groups/${groupId}`).set(carol.auth).expect(200);
    const balance = (id: string) => group.body.balances.find((b: { userId: string }) => b.userId === id).amountMinor;
    expect(balance(alice.id)).toBe(6000);
    expect(balance(bob.id)).toBe(-2500);
    expect(balance(carol.id)).toBe(-3500);
    expect(group.body.suggestedTransfers).toEqual([
      { fromUserId: carol.id, toUserId: alice.id, amountMinor: 3500 },
      { fromUserId: bob.id, toUserId: alice.id, amountMinor: 2500 },
    ]);
    expect(events().events.filter((e) => e.type === 'expense.created')).toHaveLength(2);
  });

  it('keeps every cent when a total does not divide evenly', async () => {
    const [alice, bob, carol] = [await register(app(), 'Alice'), await register(app(), 'Bob'), await register(app(), 'Carol')];
    const groupId = await groupWith(app(), [alice, bob, carol]);
    const res = await request(app())
      .post(`/groups/${groupId}/expenses`)
      .set(alice.auth)
      .send(equalExpense(alice.id, [alice.id, bob.id, carol.id], 1000))
      .expect(201);
    expect(res.body.splits.map((s: { amountMinor: number }) => s.amountMinor).sort()).toEqual([333, 333, 334]);
  });

  it('is idempotent when the client retries with the same key', async () => {
    const [alice, bob] = [await register(app(), 'Alice'), await register(app(), 'Bob')];
    const groupId = await groupWith(app(), [alice, bob]);
    const body = { ...equalExpense(alice.id, [alice.id, bob.id], 5000), idempotencyKey: 'retry-key-123' };
    const first = await request(app()).post(`/groups/${groupId}/expenses`).set(alice.auth).send(body).expect(201);
    const second = await request(app()).post(`/groups/${groupId}/expenses`).set(alice.auth).send(body).expect(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.expense.count()).toBe(1);
  });

  it('validates input and membership', async () => {
    const [alice, bob, mallory] = [await register(app(), 'Alice'), await register(app(), 'Bob'), await register(app(), 'Mallory')];
    const groupId = await groupWith(app(), [alice, bob]);
    const url = `/groups/${groupId}/expenses`;

    await request(app()).post(url).set(alice.auth).send({ description: 'x' }).expect(400);
    await request(app())
      .post(url)
      .set(alice.auth)
      .send({ ...equalExpense(alice.id, [], 100), split: { method: 'EXACT', amounts: [{ userId: alice.id, amountMinor: 50 }] } })
      .expect(422);
    await request(app()).post(url).set(alice.auth).send(equalExpense(alice.id, [alice.id, mallory.id], 100)).expect(403);
    await request(app()).get(`/groups/${groupId}`).set(mallory.auth).expect(404);
    await request(app()).post(url).set(mallory.auth).send(equalExpense(mallory.id, [mallory.id], 100)).expect(404);
  });

  it('lets only the payer or the owner delete an expense', async () => {
    const [alice, bob, carol] = [await register(app(), 'Alice'), await register(app(), 'Bob'), await register(app(), 'Carol')];
    const groupId = await groupWith(app(), [alice, bob, carol]);
    const expense = await request(app())
      .post(`/groups/${groupId}/expenses`)
      .set(bob.auth)
      .send(equalExpense(bob.id, [alice.id, bob.id, carol.id], 3000))
      .expect(201);
    await request(app()).delete(`/groups/${groupId}/expenses/${expense.body.id}`).set(carol.auth).expect(403);
    await request(app()).delete(`/groups/${groupId}/expenses/${expense.body.id}`).set(alice.auth).expect(204);
    const group = await request(app()).get(`/groups/${groupId}`).set(alice.auth).expect(200);
    expect(group.body.balances.every((b: { amountMinor: number }) => b.amountMinor === 0)).toBe(true);
  });

  it('pages through expenses with a cursor', async () => {
    const [alice, bob] = [await register(app(), 'Alice'), await register(app(), 'Bob')];
    const groupId = await groupWith(app(), [alice, bob]);
    for (let i = 0; i < 5; i++) {
      await request(app()).post(`/groups/${groupId}/expenses`).set(alice.auth).send(equalExpense(alice.id, [alice.id, bob.id], 100 + i)).expect(201);
    }
    const page1 = await request(app()).get(`/groups/${groupId}/expenses?limit=3`).set(bob.auth).expect(200);
    const page2 = await request(app()).get(`/groups/${groupId}/expenses?limit=3&cursor=${page1.body.nextCursor}`).set(bob.auth).expect(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('blocks removing a member who still has a balance', async () => {
    const [alice, bob] = [await register(app(), 'Alice'), await register(app(), 'Bob')];
    const groupId = await groupWith(app(), [alice, bob]);
    await request(app()).post(`/groups/${groupId}/expenses`).set(alice.auth).send(equalExpense(alice.id, [alice.id, bob.id], 2000)).expect(201);
    await request(app()).delete(`/groups/${groupId}/members/${bob.id}`).set(bob.auth).expect(403);
    await request(app()).delete(`/groups/${groupId}/members/${bob.id}`).set(alice.auth).expect(409);
  });
});

describe('settlements', () => {
  async function owingGroup() {
    const [alice, bob] = [await register(app(), 'Alice'), await register(app(), 'Bob')];
    const groupId = await groupWith(app(), [alice, bob]);
    await request(app()).post(`/groups/${groupId}/expenses`).set(alice.auth).send(equalExpense(alice.id, [alice.id, bob.id], 6000)).expect(201);
    return { alice, bob, groupId };
  }

  function completed(settlementId: string, eventId = 'evt_1') {
    return signedWebhook({
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', object: 'checkout.session', metadata: { settlementId } } },
    });
  }

  it('settles a debt through Stripe Checkout and a signed webhook', async () => {
    const { alice, bob, groupId } = await owingGroup();
    const checkout = await request(app())
      .post(`/groups/${groupId}/settlements/checkout`)
      .set(bob.auth)
      .send({ toUserId: alice.id, amountMinor: 3000 })
      .expect(201);
    const gateway = ctx.deps.payments as FakeStripeGateway;
    expect(gateway.checkouts[0]).toMatchObject({ amountMinor: 3000, currency: 'USD' });

    const { body, signature } = completed(checkout.body.settlementId);
    await request(app()).post('/webhooks/stripe').set('stripe-signature', signature).set('Content-Type', 'application/json').send(body).expect(200);

    const group = await request(app()).get(`/groups/${groupId}`).set(alice.auth).expect(200);
    expect(group.body.balances.every((b: { amountMinor: number }) => b.amountMinor === 0)).toBe(true);
    expect(group.body.suggestedTransfers).toEqual([]);

    // Stripe retries deliveries; a duplicate must not double count.
    const again = await request(app()).post('/webhooks/stripe').set('stripe-signature', signature).set('Content-Type', 'application/json').send(body).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(events().events.filter((e) => e.type === 'settlement.updated')).toHaveLength(1);
  });

  it('rejects webhooks with a bad signature', async () => {
    const { bob, alice, groupId } = await owingGroup();
    const checkout = await request(app()).post(`/groups/${groupId}/settlements/checkout`).set(bob.auth).send({ toUserId: alice.id, amountMinor: 3000 });
    const { body } = completed(checkout.body.settlementId);
    await request(app()).post('/webhooks/stripe').set('stripe-signature', 't=1,v1=forged').set('Content-Type', 'application/json').send(body).expect(400);
    expect((await prisma.settlement.findFirstOrThrow()).status).toBe('PENDING');
  });

  it('refuses to overpay or pay someone you do not owe', async () => {
    const { alice, bob, groupId } = await owingGroup();
    await request(app()).post(`/groups/${groupId}/settlements/checkout`).set(bob.auth).send({ toUserId: alice.id, amountMinor: 3001 }).expect(422);
    await request(app()).post(`/groups/${groupId}/settlements/checkout`).set(alice.auth).send({ toUserId: bob.id, amountMinor: 100 }).expect(422);
  });

  it('only the receiver can record a cash payment', async () => {
    const { alice, bob, groupId } = await owingGroup();
    await request(app()).post(`/groups/${groupId}/settlements/cash`).set(bob.auth).send({ fromUserId: bob.id, amountMinor: 3000 }).expect(422);
    await request(app()).post(`/groups/${groupId}/settlements/cash`).set(alice.auth).send({ fromUserId: bob.id, amountMinor: 1000 }).expect(201);
    const settlements = await request(app()).get(`/groups/${groupId}/settlements`).set(bob.auth).expect(200);
    expect(settlements.body.suggested).toEqual([{ fromUserId: bob.id, toUserId: alice.id, amountMinor: 2000 }]);
  });
});

describe('recurring expenses', () => {
  it('schedules a rule and creates one expense per period', async () => {
    const [alice, bob] = [await register(app(), 'Alice'), await register(app(), 'Bob')];
    const groupId = await groupWith(app(), [alice, bob], 'Apartment');
    const rule = await request(app())
      .post(`/groups/${groupId}/recurring`)
      .set(alice.auth)
      .send({ description: 'Rent', amountMinor: 240000, paidById: alice.id, cron: '0 9 1 * *' })
      .expect(201);
    expect((ctx.deps.recurring as MemoryRecurringScheduler).schedules.get(rule.body.id)).toBe('0 9 1 * *');

    const runAt = new Date('2026-11-01T09:00:00Z');
    expect(await runRecurringExpense(prisma, ctx.deps.events, rule.body.id, runAt)).toBe('created');
    expect(await runRecurringExpense(prisma, ctx.deps.events, rule.body.id, runAt)).toBe('duplicate');

    const group = await request(app()).get(`/groups/${groupId}`).set(bob.auth).expect(200);
    expect(group.body.suggestedTransfers).toEqual([{ fromUserId: bob.id, toUserId: alice.id, amountMinor: 120000 }]);

    await request(app()).delete(`/groups/${groupId}/recurring/${rule.body.id}`).set(bob.auth).expect(204);
    expect(await runRecurringExpense(prisma, ctx.deps.events, rule.body.id, new Date('2026-12-01T09:00:00Z'))).toBe('inactive');
  });

  it('rejects malformed cron expressions', async () => {
    const [alice] = [await register(app(), 'Alice')];
    const groupId = await groupWith(app(), [alice]);
    await request(app())
      .post(`/groups/${groupId}/recurring`)
      .set(alice.auth)
      .send({ description: 'Rent', amountMinor: 100, paidById: alice.id, cron: 'monthly' })
      .expect(400);
  });
});
