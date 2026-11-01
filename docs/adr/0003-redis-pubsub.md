# ADR-0003: Redis pub/sub for real-time fan-out

**Status:** Accepted

## Context
Several API instances may run at once. A member connected to instance A must see an expense written through instance B.

## Decision
After each committed write, the API publishes a group event to Redis. Socket.IO uses the Redis adapter, so every instance delivers the event to the sockets in that group's room.

## Consequences
- API instances stay stateless
- Delivery is at-most-once; clients refetch balances on reconnect to recover anything missed
- Redis is already required for BullMQ and rate limits, so no new infrastructure
