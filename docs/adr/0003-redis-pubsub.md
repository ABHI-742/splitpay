# ADR-0003: Redis pub/sub for real-time fan-out

**Status:** Accepted

## Context
Several API instances may run at once. A member connected to instance A must see an expense written through instance B.

## Decision
After each committed write, the API (or the job worker) publishes a group event to one Redis pub/sub channel. Every API instance subscribes to that channel and emits the event to the sockets in that group's room.

The Socket.IO Redis adapter was considered, but the job worker is not a Socket.IO server and still needs to publish events, so a plain channel is simpler and covers both.

## Consequences
- API instances stay stateless
- Delivery is at-most-once; clients refetch balances on reconnect to recover anything missed
- Redis is already required for BullMQ and rate limits, so no new infrastructure
