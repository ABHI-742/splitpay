# Deployment view (local, Docker Compose)

```mermaid
flowchart TB
    subgraph Laptop["Developer machine: docker compose"]
        web["web: Vite dev server :5173"]
        api["api: Express + Socket.IO :4000"]
        worker["worker: BullMQ jobs"]
        pg[("postgres:16 :5432")]
        redis[("redis:7 :6379")]
    end
    cli["Stripe CLI: stripe listen"]
    stripe[[Stripe test mode]]

    web -->|REST and WebSocket| api
    api --> pg
    api --> redis
    worker --> redis
    worker --> pg
    api -->|Checkout sessions| stripe
    stripe --> cli
    cli -->|forward webhooks| api
```

Recurring jobs that fail 5 times land in the `recurring-expenses-dlq` BullMQ queue in the same Redis; `npm run dlq:replay` re-queues them.

Scaling path: run several `api` containers behind a load balancer. WebSocket clients connect with the websocket transport, so no sticky sessions are needed; every instance subscribes to the same Redis channel and delivers events to its own connected clients.
