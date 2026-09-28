import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { username } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { dev } from '$app/environment';
import { prisma } from '$lib/server/db';
import { env } from '$env/dynamic/private';

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	// A headset is tested over the LAN from whatever IP the network hands out
	// that day — allow any https origin on the dev port instead of chasing a
	// moving target. Production keeps a real allow-list (comma-separated).
	trustedOrigins: dev
		? ['https://*:5173', 'http://*:5173']
		: (env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
				.map((s) => s.trim())
				.filter(Boolean) ?? []),
	database: prismaAdapter(prisma, {
		provider: 'postgresql'
	}),
	emailAndPassword: {
		enabled: true
	},
	socialProviders: {
		...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
			? {
					discord: {
						clientId: env.DISCORD_CLIENT_ID,
						clientSecret: env.DISCORD_CLIENT_SECRET
					}
				}
			: {})
	},
	plugins: [username(), sveltekitCookies(getRequestEvent)]
});
