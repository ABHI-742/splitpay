import type { Redis } from 'ioredis';

/** Real-time group events (ADR-0003). Published after a write commits. */
export type GroupEvent =
  | { type: 'expense.created'; groupId: string; expenseId: string }
  | { type: 'expense.deleted'; groupId: string; expenseId: string }
  | { type: 'member.joined'; groupId: string; userId: string }
  | { type: 'member.removed'; groupId: string; userId: string }
  | { type: 'settlement.updated'; groupId: string; settlementId: string; status: string };

export const EVENTS_CHANNEL = 'splitpay:group-events';

export interface EventPublisher {
  publish(event: GroupEvent): Promise<void>;
}

/** Publishes to a Redis channel that every API instance subscribes to (see realtime/gateway.ts). */
export class RedisEventPublisher implements EventPublisher {
  constructor(private readonly redis: Redis) {}

  async publish(event: GroupEvent): Promise<void> {
    await this.redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  }
}

export class MemoryEventPublisher implements EventPublisher {
  readonly events: GroupEvent[] = [];

  async publish(event: GroupEvent): Promise<void> {
    this.events.push(event);
  }
}
