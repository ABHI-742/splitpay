import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config';
import { expensesRouter } from './modules/expenses/expenses.routes';

export function createApp(config: Config): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));

  // Stripe webhooks need the raw body for signature verification, so they are
  // mounted before the JSON parser (roadmap: Stripe settlement flow).

  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/groups/:groupId/expenses', expensesRouter);

  return app;
}
