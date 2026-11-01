import type { Server as HttpServer } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { EVENTS_CHANNEL, type GroupEvent } from '../lib/events';
import type { TokenService } from '../modules/auth/tokens';

const room = (groupId: string) => `group:${groupId}`;

/**
 * Socket.IO gateway (ADR-0003). Clients authenticate with their access token and are joined to one
 * room per group. Every API instance subscribes to the same Redis channel, so an event published by
 * any instance (or the job worker) reaches clients connected anywhere.
 */
export function attachGateway(
  server: HttpServer,
  options: { prisma: PrismaClient; tokens: TokenService; subscriber: Redis; webOrigin: string },
): Server {
  const io = new Server(server, { cors: { origin: options.webOrigin, credentials: true } });

  io.use((socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? '');
      socket.data.userId = options.tokens.verifyAccess(token).sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    const memberships = await options.prisma.membership.findMany({ where: { userId }, select: { groupId: true } });
    await socket.join(memberships.map((m) => room(m.groupId)));

    // After accepting an invite the client asks to join the new group's room.
    socket.on('group:join', async (groupId: string, ack?: (ok: boolean) => void) => {
      const member = await options.prisma.membership.findUnique({ where: { userId_groupId: { userId, groupId } } });
      if (member) await socket.join(room(groupId));
      ack?.(Boolean(member));
    });
    socket.emit('ready');
  });

  void options.subscriber.subscribe(EVENTS_CHANNEL);
  options.subscriber.on('message', (channel, message) => {
    if (channel !== EVENTS_CHANNEL) return;
    const event = JSON.parse(message) as GroupEvent;
    io.to(room(event.groupId)).emit('group:event', event);
    if (event.type === 'member.removed') {
      io.in(room(event.groupId)).fetchSockets().then((sockets) => {
        for (const s of sockets) if (s.data.userId === event.userId) s.leave(room(event.groupId));
      });
    }
  });

  return io;
}
