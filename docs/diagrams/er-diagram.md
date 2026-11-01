# Entity-relationship diagram

Mirrors `apps/api/prisma/schema.prisma`.

```mermaid
erDiagram
    USER ||--o{ REFRESH_TOKEN : "signed in with"
    USER ||--o{ MEMBERSHIP : has
    GROUP ||--o{ MEMBERSHIP : has
    GROUP ||--o{ EXPENSE : contains
    USER ||--o{ EXPENSE : paid
    EXPENSE ||--|{ EXPENSE_SPLIT : "split into"
    USER ||--o{ EXPENSE_SPLIT : owes
    GROUP ||--o{ SETTLEMENT : records
    USER ||--o{ SETTLEMENT : "pays (from)"
    USER ||--o{ SETTLEMENT : "receives (to)"
    GROUP ||--o{ RECURRING_EXPENSE : schedules
    USER ||--o{ RECURRING_EXPENSE : pays
    GROUP ||--o{ ACTIVITY : logs
    GROUP ||--o{ INVITE : issues

    USER {
        string id PK
        string email UK
        string name
        string passwordHash "bcrypt, cost 12"
        datetime createdAt
    }
    REFRESH_TOKEN {
        string id PK
        string userId FK
        string tokenHash UK "SHA-256, never the raw token"
        datetime expiresAt "30 days"
        datetime revokedAt "set on use, logout or reuse"
        datetime createdAt
    }
    GROUP {
        string id PK
        string name
        string currency
        datetime createdAt
    }
    MEMBERSHIP {
        string userId PK
        string groupId PK
        string role
        datetime joinedAt
    }
    EXPENSE {
        string id PK
        string groupId FK
        string paidById FK
        string description
        int amountMinor
        string splitMethod
        date incurredOn
        string idempotencyKey UK "retries and races return the same row"
        datetime createdAt
    }
    EXPENSE_SPLIT {
        string expenseId PK
        string userId PK
        int amountMinor
    }
    SETTLEMENT {
        string id PK
        string groupId FK
        string fromUserId FK
        string toUserId FK
        int amountMinor
        string status
        string stripeSessionId UK
        string stripeEventId UK "webhook processed once"
        datetime createdAt
        datetime updatedAt
    }
    RECURRING_EXPENSE {
        string id PK
        string groupId FK
        string paidById FK
        string description
        int amountMinor
        string splitMethod
        string cron "BullMQ job scheduler, UTC"
        boolean active
    }
    ACTIVITY {
        string id PK
        string groupId FK
        string actorId FK
        string type
        json payload
        datetime at
    }
    INVITE {
        string token PK
        string groupId FK
        datetime expiresAt "7 days"
    }
```
