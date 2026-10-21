import { env } from '$env/dynamic/private';
import { createMetaProvider } from './meta';
import { createStripeProvider } from './stripe';
import type { PaymentProviderAdapter } from './types';

let providers: PaymentProviderAdapter[] | null = null;

/** Every provider, configured or not; `isAvailable()` says which can be used. */
export function getPaymentProviders(): PaymentProviderAdapter[] {
	providers ??= [
		createStripeProvider({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }),
		createMetaProvider({ appId: env.META_APP_ID, appSecret: env.META_APP_SECRET })
	];
	return providers;
}

export function getPaymentProvider(id: unknown): PaymentProviderAdapter | undefined {
	return getPaymentProviders().find((provider) => provider.id === id);
}
