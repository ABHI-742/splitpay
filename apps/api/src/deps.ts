import type { PrismaClient } from '@prisma/client';
import type { Config } from './config';
import type { EventPublisher } from './lib/events';
import type { PaymentGateway } from './lib/payments';
import type { RateLimitStore } from './lib/rateLimit';
import type { TokenService } from './modules/auth/tokens';
import type { RecurringScheduler } from './jobs/recurring';

/** Everything the HTTP layer needs, injected so tests can swap Stripe, Redis and BullMQ. */
export interface Deps {
  config: Config;
  prisma: PrismaClient;
  tokens: TokenService;
  events: EventPublisher;
  payments: PaymentGateway;
  rateLimitStore: RateLimitStore;
  recurring: RecurringScheduler;
}
