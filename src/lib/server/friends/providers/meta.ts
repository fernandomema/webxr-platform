import { BadRequestError } from '../../errors.ts';
import type { FriendProvider } from './types.ts';

const META_ID = /^\d{1,24}$/;

/**
 * Friends from Meta Quest. The Quest app is a Trusted Web Activity whose native side reads the player's friends with the Horizon
 * Platform SDK and hands them to the page. Meta documents no server-side friends endpoint, so the server only checks who the
 * player is: the SDK's user proof (a nonce) is validated with Meta together with the user id. Meta ids are scoped to the app,
 * which is what matching needs: every player reached it through this same app.
 */
export function createMetaFriendProvider(config: { appId?: string; appSecret?: string }, fetchImpl: typeof fetch = fetch): FriendProvider {
	return {
		id: 'meta',
		label: 'Meta Quest',
		isAvailable: () => Boolean(config.appId && config.appSecret),
		async verifyIdentity(proof) {
			const { metaUserId, nonce } = (proof ?? {}) as { metaUserId?: unknown; nonce?: unknown };
			if (typeof metaUserId !== 'string' || !META_ID.test(metaUserId) || typeof nonce !== 'string' || !nonce || nonce.length > 1024) throw new BadRequestError('Invalid Meta proof');
			const form = new URLSearchParams({ access_token: `OC|${config.appId}|${config.appSecret}`, nonce, user_id: metaUserId });
			const response = await fetchImpl('https://graph.oculus.com/user_nonce_validate', { method: 'POST', body: form });
			const result = (await response.json().catch(() => null)) as { is_valid?: boolean } | null;
			if (!response.ok || result?.is_valid !== true) throw new BadRequestError('Meta does not confirm this account');
			return metaUserId;
		},
		parseFriendIds(raw) {
			if (!Array.isArray(raw)) return [];
			return [...new Set(raw.filter((id): id is string => typeof id === 'string' && META_ID.test(id)))].slice(0, 5000);
		}
	};
}
