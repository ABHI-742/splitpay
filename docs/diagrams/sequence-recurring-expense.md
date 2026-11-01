# Sequence: recurring expense job

```mermaid
sequenceDiagram
    autonumber
    actor M as Member
    participant API as Express API
    participant DB as PostgreSQL
    participant Q as BullMQ (Redis)
    participant J as Job worker
    participant R as Redis pub/sub

    M->>API: POST /groups/42/recurring {Rent, 240000, monthly on day 1}
    API->>DB: INSERT recurring_expense
    API->>Q: add repeatable job (cron 0 9 1 * *)
    API-->>M: 201

    Note over Q,J: on the 1st of each month at 09:00
    Q->>J: run recurring:7
    J->>DB: already created for this period?
    alt not yet created
        J->>DB: INSERT expense and splits (idempotency key recurring:7:2026-11)
        J->>R: PUBLISH group:42 expense.created
    else already created
        J->>J: skip
    end
```
