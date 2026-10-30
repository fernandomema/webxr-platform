import { env } from '$env/dynamic/private';
import { createMetaFriendProvider } from './meta';
import type { FriendProvider } from './types';

let providers: FriendProvider[] | null = null;

/** Every friend provider, configured or not; `isAvailable()` says which can be used. A new platform (Steam) is one more entry. */
export function getFriendProviders(): FriendProvider[] {
	providers ??= [createMetaFriendProvider({ appId: env.META_APP_ID, appSecret: env.META_APP_SECRET })];
	return providers;
}

export function getFriendProvider(id: unknown): FriendProvider | undefined {
	return getFriendProviders().find((provider) => provider.id === id);
}
