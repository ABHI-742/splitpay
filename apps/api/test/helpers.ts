import { generateKeyPairSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import Stripe from 'stripe';
import request from 'supertest';
import type { Config } from '../src/config';
import type { Deps } from '../src/deps';
import { createApp } from '../src/app';
import { MemoryRecurringScheduler } from '../src/jobs/recurring';
import { MemoryEventPublisher } from '../src/lib/events';
import { type CheckoutRequest, StripeGateway } from '../src/lib/payments';
import { MemoryRateLimitStore } from '../src/lib/rateLimit';
import { TokenService } from '../src/modules/auth/tokens';
import { TEST_DATABASE_URL } from './globalSetup';

export const WEBHOOK_SECRET = 'whsec_test_secret';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export const config: Config = {
  NODE_ENV: 'test',
  PORT: 0,
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:56379',
  WEB_ORIGIN: 'http://localhost:5173',
  JWT_PRIVATE_KEY: privateKey,
  JWT_PUBLIC_KEY: publicKey,
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};

export const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

/** Real webhook signature verification; checkout creation is faked so tests never call Stripe. */
export class FakeStripeGateway extends StripeGateway {
  readonly checkouts: CheckoutRequest[] = [];

  constructor() {
    super(config.STRIPE_SECRET_KEY, WEBHOOK_SECRET);
  }

  override async createCheckout(req: CheckoutRequest) {
    this.checkouts.push(req);
    return { sessionId: `cs_test_${this.checkouts.length}`, url: `https://checkout.stripe.test/${this.checkouts.length}` };
  }
}

export function signedWebhook(payload: object): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const signature = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  return { body, signature };
}

export function buildDeps(overrides: Partial<Deps> = {}) {
  const deps = {
    config,
    prisma,
    tokens: new TokenService(config.JWT_PRIVATE_KEY, config.JWT_PUBLIC_KEY),
    events: new MemoryEventPublisher(),
    payments: new FakeStripeGateway(),
    rateLimitStore: new MemoryRateLimitStore(),
    recurring: new MemoryRecurringScheduler(),
    ...overrides,
  };
  return { deps, app: createApp(deps) };
}

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Activity", "ExpenseSplit", "Expense", "Settlement", "RecurringExpense", "Invite", "Membership", "RefreshToken", "Group", "User" CASCADE',
  );
}

export interface TestUser {
  id: string;
  token: string;
  auth: { Authorization: string };
}

export async function register(app: Express, name: string): Promise<TestUser> {
  const response = await request(app)
    .post('/auth/register')
    .send({ email: `${name.toLowerCase()}@example.com`, name, password: 'correct horse battery' })
    .expect(201);
  const token = response.body.accessToken as string;
  return { id: response.body.user.id, token, auth: { Authorization: `Bearer ${token}` } };
}

/** Creates a group owned by the first user and joins the others through an invite. */
export async function groupWith(app: Express, users: TestUser[], name = 'Cabin trip'): Promise<string> {
  const [owner, ...others] = users;
  const group = await request(app).post('/groups').set(owner.auth).send({ name, currency: 'usd' }).expect(201);
  const invite = await request(app).post(`/groups/${group.body.id}/invites`).set(owner.auth).expect(201);
  for (const user of others) {
    await request(app).post(`/invites/${invite.body.token}/accept`).set(user.auth).expect(200);
  }
  return group.body.id as string;
}

export function equalExpense(paidById: string, userIds: string[], amountMinor: number, description = 'Groceries') {
  return { description, amountMinor, paidById, incurredOn: '2026-10-30', split: { method: 'EQUAL', userIds } };
}
