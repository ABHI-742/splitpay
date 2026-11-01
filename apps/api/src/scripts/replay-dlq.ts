import { loadConfig } from '../config';
import { replayDeadLetters } from '../jobs/recurring';
import { createRedis } from '../lib/redis';

/** Re-queues every recurring job in the dead-letter queue. */
async function main() {
  const config = loadConfig();
  const redis = createRedis(config.REDIS_URL);
  const count = await replayDeadLetters(redis);
  console.log(`Re-queued ${count} dead-lettered recurring job(s)`);
  redis.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
