import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { simplifyDebts } from '../../domain/debtSimplifier';
import { asyncHandler, HttpError, parse } from '../../lib/http';
import { currentUserId } from '../auth/auth.routes';
import { groupBalances } from '../balances/balances.service';
import { requireMember } from './membership';

const CreateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    currency: z
      .string()
      .length(3)
      .transform((c) => c.toUpperCase())
      .default('USD'),
  })
  .strict();

const INVITE_TTL_DAYS = 7;

export function groupsRouter(deps: Deps): Router {
  const router = Router();
  const { prisma, events } = deps;

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const input = parse(CreateGroupSchema, req.body);
      const group = await prisma.group.create({
        data: { ...input, memberships: { create: { userId, role: 'OWNER' } } },
      });
      res.status(201).json(group);
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const groups = await prisma.group.findMany({
        where: { memberships: { some: { userId: currentUserId(req) } } },
        include: { _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'desc' },
      });
      res.json(groups.map(({ _count, ...g }) => ({ ...g, memberCount: _count.memberships })));
    }),
  );

  router.get(
    '/:groupId',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const { groupId } = req.params;
      const { group } = await requireMember(prisma, groupId, userId);
      const [members, balances] = await Promise.all([
        prisma.membership.findMany({
          where: { groupId },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        }),
        groupBalances(prisma, groupId),
      ]);
      res.json({
        ...group,
        members: members.map((m) => ({ ...m.user, role: m.role })),
        balances,
        suggestedTransfers: simplifyDebts(balances),
      });
    }),
  );

  router.get(
    '/:groupId/activity',
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      const items = await prisma.activity.findMany({
        where: { groupId },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { at: 'desc' },
        take: 50,
      });
      res.json(items);
    }),
  );

  router.post(
    '/:groupId/invites',
    asyncHandler(async (req, res) => {
      const { groupId } = req.params;
      await requireMember(prisma, groupId, currentUserId(req));
      const invite = await prisma.invite.create({
        data: {
          token: randomBytes(18).toString('base64url'),
          groupId,
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000),
        },
      });
      res.status(201).json({ token: invite.token, expiresAt: invite.expiresAt });
    }),
  );

  router.delete(
    '/:groupId/members/:memberId',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const { groupId, memberId } = req.params;
      await requireMember(prisma, groupId, userId, 'OWNER');
      if (memberId === userId) throw new HttpError(422, 'The owner cannot remove themselves');
      const balance = (await groupBalances(prisma, groupId)).find((b) => b.userId === memberId);
      if (!balance) throw new HttpError(404, 'Member not found');
      if (balance.amountMinor !== 0) throw new HttpError(409, 'Settle this member’s balance before removing them');
      await prisma.membership.delete({ where: { userId_groupId: { userId: memberId, groupId } } });
      await prisma.activity.create({ data: { groupId, actorId: userId, type: 'member.removed', payload: { userId: memberId } } });
      await events.publish({ type: 'member.removed', groupId, userId: memberId });
      res.status(204).end();
    }),
  );

  return router;
}

export function invitesRouter(deps: Deps): Router {
  const router = Router();
  const { prisma, events } = deps;

  router.post(
    '/:token/accept',
    asyncHandler(async (req, res) => {
      const userId = currentUserId(req);
      const invite = await prisma.invite.findUnique({ where: { token: req.params.token } });
      if (!invite || invite.expiresAt < new Date()) throw new HttpError(404, 'Invite is invalid or has expired');
      const existing = await prisma.membership.findUnique({ where: { userId_groupId: { userId, groupId: invite.groupId } } });
      if (!existing) {
        await prisma.membership.create({ data: { userId, groupId: invite.groupId } });
        await prisma.activity.create({ data: { groupId: invite.groupId, actorId: userId, type: 'member.joined', payload: {} } });
        await events.publish({ type: 'member.joined', groupId: invite.groupId, userId });
      }
      res.json({ groupId: invite.groupId });
    }),
  );

  return router;
}
