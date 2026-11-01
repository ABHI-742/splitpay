import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Redis } from 'ioredis';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisEventPublisher } from '../src/lib/events';
import { attachGateway } from '../src/realtime/gateway';
import { buildDeps, config, equalExpense, groupWith, prisma, register, resetDatabase } from './helpers';

/** Uses a real Redis (TEST_REDIS_URL) to exercise pub/sub fan-out end to end. */
describe('real-time updates', () => {
  const publisherRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  const subscriberRedis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  let server: Server;
  let url: string;
  let ctx: ReturnType<typeof buildDeps>;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await Promise.all([publisherRedis.connect(), subscriberRedis.connect()]);
    await resetDatabase();
    ctx = buildDeps({ events: new RedisEventPublisher(publisherRedis) });
    server = createServer(ctx.app);
    attachGateway(server, { prisma, tokens: ctx.deps.tokens, subscriber: subscriberRedis, webOrigin: config.WEB_ORIGIN });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await new Promise((resolve) => server.close(resolve));
    publisherRedis.disconnect();
    subscriberRedis.disconnect();
    await prisma.$disconnect();
  });

  function socketFor(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect(url, { auth: { token }, transports: ['websocket'] });
      sockets.push(socket);
      socket.once('ready', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }

  it('pushes an expense to other members as soon as it is created', async () => {
    const [alice, bob, eve] = [await register(ctx.app, 'Alice'), await register(ctx.app, 'Bob'), await register(ctx.app, 'Eve')];
    const groupId = await groupWith(ctx.app, [alice, bob]);
    const bobSocket = await socketFor(bob.token);
    const eveSocket = await socketFor(eve.token);
    const eveEvents: unknown[] = [];
    eveSocket.on('group:event', (e) => eveEvents.push(e));

    const received = new Promise<{ type: string; groupId: string }>((resolve) => bobSocket.once('group:event', resolve));
    await request(ctx.app)
      .post(`/groups/${groupId}/expenses`)
      .set(alice.auth)
      .send(equalExpense(alice.id, [alice.id, bob.id], 4200))
      .expect(201);

    await expect(received).resolves.toMatchObject({ type: 'expense.created', groupId });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(eveEvents).toEqual([]); // not a member, so not in the room
  });

  it('rejects connections without a valid token', async () => {
    await expect(socketFor('bogus')).rejects.toThrow('unauthorized');
  });
});
