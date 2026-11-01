import bcrypt from 'bcryptjs';
import { type CookieOptions, type Request, type RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Deps } from '../../deps';
import { asyncHandler, HttpError, parse } from '../../lib/http';
import { rateLimit } from '../../lib/rateLimit';
import { hashToken, newRefreshToken, REFRESH_TOKEN_TTL_DAYS } from './tokens';

const REFRESH_COOKIE = 'splitpay_refresh';

const RegisterSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(1).max(60),
    password: z.string().min(8).max(128),
  })
  .strict();

const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string() }).strict();

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(deps: Deps): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'Not authenticated'));
    try {
      req.userId = deps.tokens.verifyAccess(header.slice('Bearer '.length)).sub;
      next();
    } catch {
      next(new HttpError(401, 'Invalid or expired token'));
    }
  };
}

export function currentUserId(req: Request): string {
  if (!req.userId) throw new HttpError(401, 'Not authenticated');
  return req.userId;
}

export function authRouter(deps: Deps): Router {
  const router = Router();
  const { prisma, tokens } = deps;
  const limiter = rateLimit(deps.rateLimitStore, 'auth', 10, 60);
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: deps.config.NODE_ENV === 'production',
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000,
  };

  async function issueSession(userId: string, res: Parameters<RequestHandler>[1]) {
    const refresh = newRefreshToken();
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
      },
    });
    res.cookie(REFRESH_COOKIE, refresh.token, cookieOptions);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, name: true } });
    return { accessToken: tokens.signAccess(userId), user };
  }

  router.post(
    '/register',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parse(RegisterSchema, req.body);
      const existing = await prisma.user.findUnique({ where: { email: input.email } });
      if (existing) throw new HttpError(409, 'An account with this email already exists');
      const user = await prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash: await bcrypt.hash(input.password, 12) },
      });
      res.status(201).json(await issueSession(user.id, res));
    }),
  );

  router.post(
    '/login',
    limiter,
    asyncHandler(async (req, res) => {
      const input = parse(LoginSchema, req.body);
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
        throw new HttpError(401, 'Incorrect email or password');
      }
      res.json(await issueSession(user.id, res));
    }),
  );

  router.post(
    '/refresh',
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (!token) throw new HttpError(401, 'No refresh token');
      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
        if (stored && stored.revokedAt) {
          // A revoked token was reused: assume theft and revoke every session for this user.
          await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        throw new HttpError(401, 'Refresh token is invalid');
      }
      // Rotation: every refresh token is single-use.
      await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      res.json(await issueSession(stored.userId, res));
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (token) {
        await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
      }
      res.clearCookie(REFRESH_COOKIE, { path: '/' });
      res.status(204).end();
    }),
  );

  router.get(
    '/me',
    requireAuth(deps),
    asyncHandler(async (req, res) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: currentUserId(req) },
        select: { id: true, email: true, name: true },
      });
      res.json(user);
    }),
  );

  return router;
}
