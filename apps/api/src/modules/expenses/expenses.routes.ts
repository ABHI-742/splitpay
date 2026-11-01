import { Router } from 'express';
import type { Deps } from '../../deps';
import { asyncHandler, HttpError, parse } from '../../lib/http';
import { rateLimit } from '../../lib/rateLimit';
import { currentUserId } from '../auth/auth.routes';
import { requireMember } from '../groups/membership';
import { createExpense } from './expenses.service';
import { CreateExpenseSchema, ListExpensesSchema } from './expenses.schema';

export function expensesRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  const { prisma, events } = deps;

  router.post(
    '/',
    rateLimit(deps.rateLimitStore, 'write', 120, 60),
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const { groupId } = req.params;
      await requireMember(prisma, groupId, userId);
      const input = parse(CreateExpenseSchema, req.body);
      const { expense, created } = await createExpense(prisma, events, groupId, userId, input);
      const full = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id }, include: { splits: true } });
      res.status(created ? 201 : 200).json(full);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      const { cursor, limit } = parse(ListExpensesSchema, req.query);
      const expenses = await prisma.expense.findMany({
        where: { groupId },
        include: { splits: true },
        orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const hasMore = expenses.length > limit;
      const page = expenses.slice(0, limit);
      res.json({ items: page, nextCursor: hasMore ? page[page.length - 1].id : null });
    }),
  );

  router.delete(
    '/:expenseId',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const { groupId, expenseId } = req.params;
      const membership = await requireMember(prisma, groupId, userId);
      const expense = await prisma.expense.findFirst({ where: { id: expenseId, groupId } });
      if (!expense) throw new HttpError(404, 'Expense not found');
      if (expense.paidById !== userId && membership.role !== 'OWNER') {
        throw new HttpError(403, 'Only the payer or the group owner can delete this expense');
      }
      await prisma.$transaction([
        prisma.expense.delete({ where: { id: expense.id } }),
        prisma.activity.create({
          data: {
            groupId,
            actorId: userId,
            type: 'expense.deleted',
            payload: { expenseId: expense.id, description: expense.description, amountMinor: expense.amountMinor },
          },
        }),
      ]);
      await events.publish({ type: 'expense.deleted', groupId, expenseId: expense.id });
      res.status(204).end();
    }),
  );

  return router;
}
