# ADR-0001: Store money as integer minor units

**Status:** Accepted

## Context
Floating-point arithmetic cannot represent most decimal amounts exactly (0.1 + 0.2 ≠ 0.3). Splitting $100 three ways must not lose or invent a cent.

## Decision
Store every amount as an integer number of minor units (cents) together with the group's ISO currency code. Split calculations work in integers and distribute leftover cents one at a time to the first participants in a stable order.

## Consequences
- Splits always sum exactly to the expense total
- Display formatting happens only at the edges (UI, emails)
- Currencies with three decimal places would need a per-currency exponent (future work)
