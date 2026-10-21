import { createAuthClient } from 'better-auth/client';
import { usernameClient } from 'better-auth/client/plugins';
import { getPlatformConfig } from './config.ts';

function build() {
	const config = getPlatformConfig();
	return createAuthClient({
		baseURL: config.apiBase || undefined,
		plugins: [usernameClient()],
		fetchOptions: {
			credentials: config.apiBase ? (config.getToken ? 'omit' : 'include') : 'same-origin',
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

/**
 * Who is signed in, or nobody when the platform cannot be reached: a game has to start offline (the platform being down, or a
 * browser refusing its certificate, must not stop anyone from playing), and sign-in is for what needs the platform.
 */
export async function currentUser() {
	try {
		const { data } = await platformAuth().getSession();
		return data?.user ?? null;
	} catch (error) {
		console.warn('[platform] could not check the session; playing without an account', error);
		return null;
	}
}
