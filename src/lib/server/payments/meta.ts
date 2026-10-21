import { findPackByMetaSku } from '@kithin/engine/credits/catalog';
import type { PaymentProviderAdapter } from './types.ts';

/**
 * Purchases made inside the headset with Meta's in-app payments (the Digital Goods API, available to WebXR apps installed
 * from the Horizon Store). The device returns a receipt; this server checks with Meta that the player really owns that item,
 * then consumes it so the same purchase can never be credited again.
 *
 * Meta's server-to-server calls (`verify_entitlement`, `consume_entitlement` on graph.oculus.com) identify a purchase by the
 * player's Meta user id and the item, so the client passes that id along with the receipt. Meta's documentation does not
 * describe how this applies to web purchases: confirm it against a real store build before turning this provider on in
 * production (it stays off until META_APP_ID and META_APP_SECRET are set).
 */
export function createMetaProvider(config: { appId?: string; appSecret?: string }, fetchImpl: typeof fetch = fetch): PaymentProviderAdapter {
	const call = async (path: 'verify_entitlement' | 'consume_entitlement', metaUserId: string, sku: string): Promise<boolean> => {
		const form = new URLSearchParams({ access_token: `OC|${config.appId}|${config.appSecret}`, user_id: metaUserId, sku });
		const response = await fetchImpl(`https://graph.oculus.com/${config.appId}/${path}`, { method: 'POST', body: form });
		const result = (await response.json().catch(() => null)) as { success?: boolean } | null;
		return response.ok && result?.success === true;
	};
	return {
		id: 'meta',
		label: 'Meta Quest',
		isAvailable: () => Boolean(config.appId && config.appSecret),
		externalIdOf(receipt) {
			const id = (receipt as { metaUserId?: unknown } | null)?.metaUserId;
			return typeof id === 'string' && /^\d{1,24}$/.test(id) ? id : null;
		},
		async confirmReceipt(user, receipt) {
			const { sku, purchaseToken, metaUserId } = (receipt ?? {}) as { sku?: unknown; purchaseToken?: unknown; metaUserId?: unknown };
			const pack = findPackByMetaSku(sku);
			if (!pack || typeof purchaseToken !== 'string' || !purchaseToken || purchaseToken.length > 512 || typeof metaUserId !== 'string' || !/^\d{1,24}$/.test(metaUserId)) throw new Error('Invalid receipt');
			if (!(await call('verify_entitlement', metaUserId, pack.metaSku))) throw new Error('Meta does not confirm this purchase');
			// Consuming succeeds once per purchase: it is what makes crediting it exactly once, whoever sends the receipt.
			if (!(await call('consume_entitlement', metaUserId, pack.metaSku))) throw new Error('Meta could not consume this purchase');
			return { userId: user.id, pack, provider: 'meta', providerRef: purchaseToken, idempotencyKey: `meta:${purchaseToken}`, externalId: metaUserId };
		}
	};
}
