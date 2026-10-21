import { createHmac, timingSafeEqual } from 'node:crypto';
import { findPack } from '../../credits/catalog.ts';
import type { CreditGrant, PaymentProviderAdapter } from './types.ts';

/** Stripe sends a time and a signature of `time.body`; five minutes of difference is the tolerance Stripe documents. */
const TOLERANCE_SECONDS = 300;

/** Whether `header` (Stripe-Signature) is a valid signature of `rawBody` made with `secret`. */
export function verifyStripeSignature(secret: string, header: string | null, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
	if (!header) return false;
	let timestamp = 0;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, value] = part.split('=');
		if (key === 't') timestamp = Number(value);
		else if (key === 'v1' && value) signatures.push(value);
	}
	if (!Number.isFinite(timestamp) || timestamp <= 0 || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS || signatures.length === 0) return false;
	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
	return signatures.some((signature) => {
		const given = Buffer.from(signature, 'hex');
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

interface StripeSession {
	id?: string;
	payment_status?: string;
	amount_total?: number;
	currency?: string;
	client_reference_id?: string;
	metadata?: Record<string, string>;
}

/**
 * What to credit for a Stripe event. The credits come from our own pack catalog, never from the event's metadata, and the
 * amount Stripe says was paid must match the pack's price: a session made for one pack cannot be passed off as another.
 */
export function grantFromStripeEvent(event: unknown): CreditGrant | null {
	const { type, data } = (event ?? {}) as { type?: string; data?: { object?: StripeSession } };
	if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') return null;
	const session = data?.object;
	if (!session || typeof session.id !== 'string' || session.payment_status !== 'paid') return null;
	const pack = findPack(session.metadata?.packId);
	const userId = session.client_reference_id;
	if (!pack || typeof userId !== 'string' || !userId) return null;
	if (session.amount_total !== pack.priceCents || session.currency !== pack.currency) return null;
	return { userId, pack, provider: 'stripe', providerRef: session.id, idempotencyKey: `stripe:${session.id}` };
}

export function createStripeProvider(config: { secretKey?: string; webhookSecret?: string }, fetchImpl: typeof fetch = fetch): PaymentProviderAdapter {
	return {
		id: 'stripe',
		label: 'Card (Stripe)',
		isAvailable: () => Boolean(config.secretKey && config.webhookSecret),
		async startCheckout(user, pack, urls) {
			if (!config.secretKey) throw new Error('Stripe is not configured');
			const form = new URLSearchParams({
				mode: 'payment',
				success_url: urls.success,
				cancel_url: urls.cancel,
				client_reference_id: user.id,
				customer_email: user.email,
				'metadata[packId]': pack.id,
				'line_items[0][quantity]': '1',
				'line_items[0][price_data][currency]': pack.currency,
				'line_items[0][price_data][unit_amount]': String(pack.priceCents),
				'line_items[0][price_data][product_data][name]': `${pack.credits} credits`
			});
			const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
				method: 'POST',
				headers: { authorization: `Bearer ${config.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
				body: form
			});
			const session = (await response.json().catch(() => null)) as { url?: string } | null;
			if (!response.ok || typeof session?.url !== 'string') throw new Error('Could not start the payment');
			return { url: session.url };
		},
		async handleWebhook(rawBody, headers) {
			if (!config.webhookSecret || !verifyStripeSignature(config.webhookSecret, headers.get('stripe-signature'), rawBody)) throw new Error('Invalid signature');
			return grantFromStripeEvent(JSON.parse(rawBody));
		}
	};
}
