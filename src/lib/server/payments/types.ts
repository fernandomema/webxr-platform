import type { CreditPack } from '../../credits/catalog.ts';

/** Credits a payment provider has confirmed were paid for. The ledger applies it once per `idempotencyKey`. */
export interface CreditGrant {
	userId: string;
	pack: CreditPack;
	provider: string;
	/** The provider's own id for the payment, kept in the ledger. */
	providerRef: string;
	idempotencyKey: string;
	/** The store account that paid, when the provider has one. */
	externalId?: string;
}

export interface CheckoutUrls {
	success: string;
	cancel: string;
}

/**
 * A way of paying for credits. Providers differ in how the money is confirmed — Stripe tells our server with a signed
 * webhook, a store tells it with a receipt the player's device holds — so each implements only the steps it has. None of
 * them credits anything itself: they return a `CreditGrant` and the ledger applies it.
 */
export interface PaymentProviderAdapter {
	readonly id: 'stripe' | 'meta';
	readonly label: string;
	/** Whether the server has what it needs (keys, app ids) to use it. */
	isAvailable(): boolean;
	/** Where the player pays: returns a page to send them to. */
	startCheckout?(user: { id: string; email: string }, pack: CreditPack, urls: CheckoutUrls): Promise<{ url: string }>;
	/** A notification from the provider's servers. Returns what to credit, or `null` for events that are not a completed payment. Throws when it is not authentic. */
	handleWebhook?(rawBody: string, headers: Headers): Promise<CreditGrant | null>;
	/** The store account a receipt names, when it names one, read before the provider is contacted. */
	externalIdOf?(receipt: unknown): string | null;
	/** A receipt the player's device holds. Verified with the provider before anything is credited. */
	confirmReceipt?(user: { id: string }, receipt: unknown): Promise<CreditGrant>;
}
