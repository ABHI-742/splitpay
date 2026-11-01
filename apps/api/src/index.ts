import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { BullRecurringScheduler } from './jobs/recurring';
import { RedisEventPublisher } from './lib/events';
import { StripeGateway } from './lib/payments';
import { prisma } from './lib/prisma';
import { RedisRateLimitStore } from './lib/rateLimit';
import { createRedis } from './lib/redis';
import { TokenService } from './modules/auth/tokens';
import { attachGateway } from './realtime/gateway';

const config = loadConfig();
const redis = createRedis(config.REDIS_URL);
const tokens = new TokenService(config.JWT_PRIVATE_KEY, config.JWT_PUBLIC_KEY);

const app = createApp({
  config,
  prisma,
  tokens,
  events: new RedisEventPublisher(redis),
  payments: new StripeGateway(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET),
  rateLimitStore: new RedisRateLimitStore(redis),
  recurring: new BullRecurringScheduler(createRedis(config.REDIS_URL)),
});

const server = createServer(app);
attachGateway(server, { prisma, tokens, subscriber: createRedis(config.REDIS_URL), webOrigin: config.WEB_ORIGIN });

server.listen(config.PORT, () => {
  console.log(`SplitPay API listening on :${config.PORT}`);
});

const shutdown = () => {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
