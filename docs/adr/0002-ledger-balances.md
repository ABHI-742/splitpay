# ADR-0002: Derive balances from a ledger

**Status:** Accepted

## Context
A stored "balance" column must be updated on every expense edit, deletion and settlement, and any missed update makes it permanently wrong.

## Decision
Never store balances. Compute them from expenses, expense splits and paid settlements with one aggregate query per group.

## Consequences
- Edits and deletions are automatically reflected
- Balances can be audited back to individual entries
- The aggregate runs on every write; it is indexed by group and cheap at group sizes (tens of members, thousands of expenses). A cached projection can be added later if needed
