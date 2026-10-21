import { createAuthClient } from 'better-auth/client';
import { usernameClient } from 'better-auth/client/plugins';
import { getPlatformConfig } from './config.ts';

function build() {
	const config = getPlatformConfig();
	return createAuthClient({
		baseURL: config.apiBase || undefined,
		plugins: [usernameClient()],
		fetchOptions: {
			credentials: config.apiBase ? 'include' : 'same-origin',
			// On a page that is not on the platform's origin the account travels as a bearer token instead of a cookie.
			auth: { type: 'Bearer', token: async () => (config.getToken ? ((await config.getToken()) ?? undefined) : undefined) }
		}
	});
}

export type PlatformAuthClient = ReturnType<typeof build>;

let client: PlatformAuthClient | null = null;
let builtFor: ReturnType<typeof getPlatformConfig> | null = null;

/** The account client of the platform the engine is configured for (see `configurePlatform`). */
export function platformAuth(): PlatformAuthClient {
	const config = getPlatformConfig();
	if (!client || builtFor !== config) {
		client = build();
		builtFor = config;
	}
	return client;
}
