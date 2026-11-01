import Stripe from 'stripe';

export interface CheckoutRequest {
  settlementId: string;
  amountMinor: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

export type PaymentEvent =
  | { id: string; type: 'checkout.completed'; settlementId: string; sessionId: string }
  | { id: string; type: 'checkout.expired'; settlementId: string; sessionId: string }
  | { id: string; type: 'ignored' };

export interface PaymentGateway {
  createCheckout(request: CheckoutRequest): Promise<{ sessionId: string; url: string }>;
  /** Verifies the webhook signature and normalises the event. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, signature: string): PaymentEvent;
}

export class StripeGateway implements PaymentGateway {
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckout(request: CheckoutRequest): Promise<{ sessionId: string; url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: request.currency.toLowerCase(),
            unit_amount: request.amountMinor,
            product_data: { name: request.description },
          },
        },
      ],
      client_reference_id: request.settlementId,
      metadata: { settlementId: request.settlementId },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    return { sessionId: session.id, url: session.url ?? request.cancelUrl };
  }

  parseWebhook(rawBody: Buffer, signature: string): PaymentEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const settlementId = session.metadata?.settlementId;
      if (settlementId) {
        return {
          id: event.id,
          type: event.type === 'checkout.session.completed' ? 'checkout.completed' : 'checkout.expired',
          settlementId,
          sessionId: session.id,
        };
      }
    }
    return { id: event.id, type: 'ignored' };
  }
}
