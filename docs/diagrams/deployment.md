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

Scaling path: run several `api` containers behind a load balancer with sticky sessions disabled; the Socket.IO Redis adapter keeps group rooms consistent across instances.
