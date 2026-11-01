import type { Redis } from 'ioredis';
import type { RequestHandler } from 'express';

export interface RateLimitStore {
  /** Increments the counter for key and returns the new count; the window starts on the first hit. */
  hit(key: string, windowSeconds: number): Promise<number>;
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}

  async hit(key: string, windowSeconds: number): Promise<number> {
    const [[, count]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, windowSeconds, 'NX')
      .exec()) as [[unknown, number]];
    return count;
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counts = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const entry = this.counts.get(key);
    if (!entry || entry.resetAt <= now) {
      this.counts.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}

/** Fixed-window limiter keyed by client IP and route name. */
export function rateLimit(store: RateLimitStore, name: string, limit: number, windowSeconds: number): RequestHandler {
  return (req, res, next) => {
    store
      .hit(`ratelimit:${name}:${req.ip}`, windowSeconds)
      .then((count) => {
        if (count > limit) {
          res.setHeader('Retry-After', String(windowSeconds));
          res.status(429).json({ message: 'Too many requests, try again later' });
          return;
        }
        next();
      })
      .catch(next);
  };
}
