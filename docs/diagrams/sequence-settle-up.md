# Sequence: settle up with Stripe (test mode)

```mermaid
sequenceDiagram
    autonumber
    actor B as Bob (debtor)
    participant W as Web
    participant API as Express API
    participant DB as PostgreSQL
    participant S as Stripe
    participant R as Redis
    participant GW as Socket.IO gateway

    B->>W: Open "Settle up"
    W->>API: GET /groups/42/settlements/suggested
    API->>DB: aggregate balances
    API->>API: simplifyDebts(balances)
    API-->>W: Bob pays Alice $30
    B->>W: Pay with card
    W->>API: POST /groups/42/settlements {to: Alice, amount: 3000}
    API->>DB: INSERT settlement (status PENDING)
    API->>S: create Checkout Session (metadata: settlement_id)
    S-->>API: session URL
    API-->>W: redirect URL
    W->>S: Bob pays on Stripe Checkout
    S-->>W: redirect to success page

    S->>API: POST /webhooks/stripe checkout.session.completed
    API->>API: verify signature
    API->>DB: event ID already processed?
    alt new event
        API->>DB: settlement status PAID, store event ID, add activity
        API->>R: PUBLISH group:42 settlement.paid + balances
        R-->>GW: fan out
        GW-->>W: emit settlement.paid
    else duplicate event
        API->>API: ignore
    end
    API-->>S: 200
```
