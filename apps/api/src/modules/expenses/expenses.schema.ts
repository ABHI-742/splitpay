import { z } from 'zod';

const minor = z.number().int().nonnegative();

export const CreateExpenseSchema = z
  .object({
    description: z.string().trim().min(1).max(140),
    amountMinor: z.number().int().positive(),
    paidById: z.string().min(1),
    incurredOn: z.coerce.date(),
    idempotencyKey: z.string().uuid().optional(),
    split: z.discriminatedUnion('method', [
      z.object({ method: z.literal('EQUAL'), userIds: z.array(z.string()).min(1) }),
      z.object({
        method: z.literal('EXACT'),
        amounts: z.array(z.object({ userId: z.string(), amountMinor: minor })).min(1),
      }),
      z.object({
        method: z.literal('PERCENTAGE'),
        percents: z.array(z.object({ userId: z.string(), percent: z.number().positive() })).min(1),
      }),
      z.object({
        method: z.literal('SHARES'),
        shares: z.array(z.object({ userId: z.string(), shares: z.number().int().positive() })).min(1),
      }),
    ]),
  })
  .strict();

export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;
