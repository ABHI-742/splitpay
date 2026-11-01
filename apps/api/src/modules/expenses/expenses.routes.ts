import { Router } from 'express';
import { CreateExpenseSchema } from './expenses.schema';

export const expensesRouter = Router({ mergeParams: true });

// Flow: docs/diagrams/activity-add-expense.md and sequence-add-expense.md
expensesRouter.post('/', (req, res) => {
  const parsed = CreateExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errors: parsed.error.flatten() });
    return;
  }
  // Roadmap: membership check, idempotency, split calculation, transaction,
  // balance recompute and Redis publish.
  res.status(501).json({ message: 'Roadmap: expenses and live balances' });
});
