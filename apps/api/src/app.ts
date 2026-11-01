import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Deps } from './deps';
import { errorHandler, HttpError } from './lib/http';
import { authRouter, requireAuth } from './modules/auth/auth.routes';
import { expensesRouter } from './modules/expenses/expenses.routes';
import { groupsRouter, invitesRouter } from './modules/groups/groups.routes';
import { recurringRouter } from './modules/recurring/recurring.routes';
import { settlementsRouter, stripeWebhookRouter } from './modules/settlements/settlements.routes';

export function createApp(deps: Deps): Express {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: deps.config.WEB_ORIGIN, credentials: true }));

  // Stripe needs the raw body to verify signatures, so this is mounted before express.json().
  app.use('/webhooks/stripe', stripeWebhookRouter(deps));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter(deps));

  const auth = requireAuth(deps);
  app.use('/groups', auth, groupsRouter(deps));
  app.use('/groups/:groupId/expenses', auth, expensesRouter(deps));
  app.use('/groups/:groupId/settlements', auth, settlementsRouter(deps));
  app.use('/groups/:groupId/recurring', auth, recurringRouter(deps));
  app.use('/invites', auth, invitesRouter(deps));

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(errorHandler);
  return app;
}
