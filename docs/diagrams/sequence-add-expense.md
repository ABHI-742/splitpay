# Sequence: add expense and live update

```mermaid
sequenceDiagram
    autonumber
    actor A as Alice
    participant WA as Alice's browser
    participant API as Express API
    participant DB as PostgreSQL
    participant R as Redis
    participant GW as Socket.IO gateway
    participant WB as Bob's browser

    WB->>GW: connect (JWT), join room group:42
    A->>WA: Add "Groceries $90, split equally"
    WA->>API: POST /groups/42/expenses
    API->>API: Zod validate, check membership
    API->>API: computeSplits(9000 cents, 3 members)
    API->>DB: BEGIN
    API->>DB: INSERT expense, expense_splits, activity
    API->>DB: COMMIT
    API->>DB: aggregate balances for group 42
    API->>R: PUBLISH group:42 expense.created + balances
    API-->>WA: 201 expense
    R-->>GW: message on group:42
    GW-->>WB: emit expense.created
    GW-->>WA: emit expense.created
    WB->>WB: update balances and feed without reload
```
