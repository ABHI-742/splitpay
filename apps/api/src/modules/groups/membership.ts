import type { MemberRole, PrismaClient } from '@prisma/client';
import { HttpError } from '../../lib/http';

/** Returns the caller's membership or a 404, so non-members can't probe group IDs. */
export async function requireMember(
  prisma: PrismaClient,
  groupId: string,
  userId: string,
  role?: MemberRole,
) {
  const membership = await prisma.membership.findUnique({
    where: { userId_groupId: { userId, groupId } },
    include: { group: true },
  });
  if (!membership) throw new HttpError(404, 'Group not found');
  if (role && membership.role !== role) throw new HttpError(403, `Only the group ${role.toLowerCase()} can do this`);
  return membership;
}

export async function memberIds(prisma: PrismaClient, groupId: string): Promise<string[]> {
  const rows = await prisma.membership.findMany({ where: { groupId }, select: { userId: true }, orderBy: { joinedAt: 'asc' } });
  return rows.map((r) => r.userId);
}
