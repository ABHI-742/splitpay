# Class diagram

The data model (top) mirrors `apps/api/prisma/schema.prisma`. The services (bottom) use the names in `apps/api/src`; plain function modules are shown as `<<module>>`.

```mermaid
classDiagram
    direction LR

    class User {
        +string id
        +string email
        +string name
    }
    class RefreshToken {
        +string tokenHash
        +Date expiresAt
        +Date revokedAt
    }
    class Group {
        +string id
        +string name
        +string currency
    }
    class Membership {
        +MemberRole role
        +Date joinedAt
    }
    class Expense {
        +string id
        +int amountMinor
        +SplitMethod splitMethod
        +Date incurredOn
        +string idempotencyKey
    }
    class ExpenseSplit {
        +int amountMinor
    }
    class Settlement {
        +int amountMinor
        +SettlementStatus status
        +string stripeSessionId
        +string stripeEventId
    }
    class RecurringExpense {
        +string cron
        +int amountMinor
        +bool active
    }

    User "1" -- "many" RefreshToken
    User "1" -- "many" Membership
    Group "1" -- "many" Membership
    Group "1" *-- "many" Expense
    Expense "1" *-- "many" ExpenseSplit
    Group "1" *-- "many" Settlement
    Group "1" *-- "many" RecurringExpense

    class TokenService {
        +signAccess(userId) string
        +verifyAccess(token) AccessClaims
    }
    class expensesService {
        <<module>>
        +createExpense(groupId, actor, input) Expense
        +computeShares(input) Share[]
    }
    class splitCalculator {
        <<module>>
        +splitEqually()
        +splitExactly()
        +splitByPercentage()
        +splitByShares()
    }
    class debtSimplifier {
        <<module>>
        +simplifyDebts(balances) Transfer[]
    }
    class balancesService {
        <<module>>
        +groupBalances(groupId) Balance[]
    }
    class EventPublisher {
        <<interface>>
        +publish(event)
    }
    class RedisEventPublisher
    class MemoryEventPublisher
    EventPublisher <|.. RedisEventPublisher
    EventPublisher <|.. MemoryEventPublisher

    class PaymentGateway {
        <<interface>>
        +createCheckout(request) Checkout
        +parseWebhook(payload, signature) PaymentEvent
    }
    class StripeGateway
    PaymentGateway <|.. StripeGateway

    class RecurringScheduler {
        <<interface>>
        +schedule(recurringId, cron)
        +unschedule(recurringId)
    }
    class BullRecurringScheduler
    class MemoryRecurringScheduler
    RecurringScheduler <|.. BullRecurringScheduler
    RecurringScheduler <|.. MemoryRecurringScheduler

    class RecurringWorker {
        +Worker worker
        +Queue deadLetters
        +close()
    }
    class RateLimitStore {
        <<interface>>
        +hit(key, windowSeconds) int
    }
    class RedisRateLimitStore
    RateLimitStore <|.. RedisRateLimitStore

    expensesService --> splitCalculator
    expensesService --> EventPublisher
    RecurringWorker --> expensesService : runRecurringExpense
    RecurringWorker --> EventPublisher
```

Every interface has an in-memory or fake implementation for the tests (`MemoryEventPublisher`, `MemoryRecurringScheduler`, `MemoryRateLimitStore`, `FakeStripeGateway`).
