import { loadConfig } from './config';
import { startRecurringWorker } from './jobs/recurring';
import { RedisEventPublisher } from './lib/events';
import { prisma } from './lib/prisma';
import { createRedis } from './lib/redis';

const config = loadConfig();
const events = new RedisEventPublisher(createRedis(config.REDIS_URL));
const worker = startRecurringWorker(createRedis(config.REDIS_URL), prisma, events);

worker.on('completed', (job, result) => console.log(`recurring ${job.data.recurringId}: ${result}`));
worker.on('failed', (job, err) => console.error(`recurring ${job?.data.recurringId} failed`, err));
console.log('SplitPay worker started');

const shutdown = async () => {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
