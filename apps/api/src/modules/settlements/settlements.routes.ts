import express, { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { simplifyDebts } from '../../domain/debtSimplifier';
import { asyncHandler, HttpError, parse } from '../../lib/http';
import { currentUserId } from '../auth/auth.routes';
import { groupBalances } from '../balances/balances.service';
import { requireMember } from '../groups/membership';

const CheckoutSchema = z.object({ toUserId: z.string(), amountMinor: z.number().int().positive() }).strict();
const CashSchema = z.object({ fromUserId: z.string(), amountMinor: z.number().int().positive() }).strict();

/** Settle-up flow: docs/diagrams/sequence-settle-up.md and state-settlement.md */
export function settlementsRouter(deps: Deps): Router {
  const router = Router({ mergeParams: true });
  const { prisma, events, payments, config } = deps;

  async function assertOwes(groupId: string, fromUserId: string, toUserId: string, amountMinor: number) {
    if (fromUserId === toUserId) throw new HttpError(422, 'You cannot settle with yourself');
    const balances = await groupBalances(prisma, groupId);
    const from = balances.find((b) => b.userId === fromUserId);
    const to = balances.find((b) => b.userId === toUserId);
    if (!from || !to) throw new HttpError(404, 'Member not found');
    if (from.amountMinor >= 0 || to.amountMinor <= 0) throw new HttpError(422, 'No debt between these members');
    if (amountMinor > Math.min(-from.amountMinor, to.amountMinor)) {
      throw new HttpError(422, 'Amount is more than is owed');
    }
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      const [settlements, balances] = await Promise.all([
        prisma.settlement.findMany({ where: { groupId }, orderBy: { createdAt: 'desc' }, take: 50 }),
        groupBalances(prisma, groupId),
      ]);
      res.json({ settlements, suggested: simplifyDebts(balances) });
    }),
  );

  router.post(
    '/checkout',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const { groupId } = req.params;
      const { group } = await requireMember(prisma, groupId, userId);
      const input = parse(CheckoutSchema, req.body);
      await assertOwes(groupId, userId, input.toUserId, input.amountMinor);

      const recipient = await prisma.user.findUniqueOrThrow({ where: { id: input.toUserId } });
      const settlement = await prisma.settlement.create({
        data: { groupId, fromUserId: userId, toUserId: input.toUserId, amountMinor: input.amountMinor, status: 'PENDING' },
      });
      const checkout = await payments.createCheckout({
        settlementId: settlement.id,
        amountMinor: settlement.amountMinor,
        currency: group.currency,
        description: `SplitPay: ${group.name} – pay ${recipient.name}`,
        successUrl: `${config.WEB_ORIGIN}/groups/${groupId}?settlement=${settlement.id}&status=success`,
        cancelUrl: `${config.WEB_ORIGIN}/groups/${groupId}?settlement=${settlement.id}&status=cancelled`,
      });
      await prisma.settlement.update({ where: { id: settlement.id }, data: { stripeSessionId: checkout.sessionId } });
      res.status(201).json({ settlementId: settlement.id, checkoutUrl: checkout.url });
    }),
  );

  router.post(
    '/cash',
    asyncHandler(async (req, res) => {
      // Recorded by the person who received the cash, so a debtor can't mark their own debt paid.
      const userId = currentUserId(req);
      const { groupId } = req.params;
      await requireMember(prisma, groupId, userId);
      const input = parse(CashSchema, req.body);
      await assertOwes(groupId, input.fromUserId, userId, input.amountMinor);
      const settlement = await prisma.$transaction(async (tx) => {
        const created = await tx.settlement.create({
          data: { groupId, fromUserId: input.fromUserId, toUserId: userId, amountMinor: input.amountMinor, status: 'RECORDED_CASH' },
        });
        await tx.activity.create({
          data: { groupId, actorId: userId, type: 'settlement.cash', payload: { settlementId: created.id, amountMinor: created.amountMinor } },
        });
        return created;
      });
      await events.publish({ type: 'settlement.updated', groupId, settlementId: settlement.id, status: settlement.status });
      res.status(201).json(settlement);
    }),
  );

  return router;
}

/** Stripe webhook. Mounted with a raw body parser before express.json() (signature needs raw bytes). */
export function stripeWebhookRouter(deps: Deps): Router {
  const router = Router();
  const { prisma, events, payments } = deps;

  router.post(
    '/',
    express.raw({ type: 'application/json' }),
    asyncHandler(async (req, res) => {
      const signature = req.header('stripe-signature');
      if (!signature) throw new HttpError(400, 'Missing signature');
      let event;
      try {
        event = payments.parseWebhook(req.body as Buffer, signature);
      } catch {
        throw new HttpError(400, 'Invalid signature');
      }
      if (event.type === 'ignored') {
        res.json({ received: true });
        return;
      }

      const settlement = await prisma.settlement.findUnique({ where: { id: event.settlementId } });
      if (!settlement || settlement.stripeEventId === event.id || settlement.status !== 'PENDING') {
        res.json({ received: true, duplicate: true });
        return;
      }
      const status = event.type === 'checkout.completed' ? 'PAID' : 'EXPIRED';
      // The status condition makes concurrent deliveries of the same event safe.
      const updated = await prisma.settlement.updateMany({
        where: { id: settlement.id, status: 'PENDING' },
        data: { status, stripeEventId: event.id },
      });
      if (updated.count === 1) {
        await prisma.activity.create({
          data: {
            groupId: settlement.groupId,
            actorId: settlement.fromUserId,
            type: status === 'PAID' ? 'settlement.paid' : 'settlement.expired',
            payload: { settlementId: settlement.id, amountMinor: settlement.amountMinor },
          },
        });
        await events.publish({ type: 'settlement.updated', groupId: settlement.groupId, settlementId: settlement.id, status });
      }
      res.json({ received: true });
    }),
  );

  return router;
}
