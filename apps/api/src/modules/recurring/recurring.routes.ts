import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { asyncHandler, HttpError, parse } from '../../lib/http';
import { currentUserId } from '../auth/auth.routes';
import { memberIds, requireMember } from '../groups/membership';

// Five-field cron: minute hour day-of-month month day-of-week
const CRON = /^(\S+\s+){4}\S+$/;

const CreateRecurringSchema = z
  .object({
    description: z.string().trim().min(1).max(100),
    amountMinor: z.number().int().positive(),
    paidById: z.string(),
    cron: z.string().trim().regex(CRON, 'Use a five-field cron expression, e.g. "0 9 1 * *"'),
  })
  .strict();

/** docs/diagrams/sequence-recurring-expense.md */
export function recurringRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  const { prisma, recurring } = deps;

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      const input = parse(CreateRecurringSchema, req.body);
      if (!(await memberIds(prisma, groupId)).includes(input.paidById)) {
        throw new HttpError(403, 'Payer must be a group member');
      }
      const rule = await prisma.recurringExpense.create({ data: { ...input, groupId } });
      await recurring.schedule(rule.id, rule.cron);
      res.status(201).json(rule);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      res.json(await prisma.recurringExpense.findMany({ where: { groupId, active: true }, orderBy: { createdAt: 'asc' } }));
    }),
  );

  router.delete(
    '/:recurringId',
    asyncHandler(async (req, res) => {
      const { groupId, recurringId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      const rule = await prisma.recurringExpense.findFirst({ where: { id: recurringId, groupId } });
      if (!rule) throw new HttpError(404, 'Recurring expense not found');
      await prisma.recurringExpense.update({ where: { id: rule.id }, data: { active: false } });
      await recurring.unschedule(rule.id);
      res.status(204).end();
    }),
  );

  return router;
}
