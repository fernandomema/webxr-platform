import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { admin, bearer, deviceAuthorization, username } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { dev } from '$app/environment';
import { prisma } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { parseAllowedOrigins } from '$lib/server/cors';
import { appAllowsOrigin } from '$lib/server/appOrigins';

/** The client id a game gives when it asks to sign in without being a published world of its own. */
export const ENGINE_CLIENT_ID = 'kithin-engine';

export const auth = betterAuth({
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.BETTER_AUTH_URL,
	// A headset is tested over the LAN from whatever IP the network hands out
	// that day — allow any https origin on the dev port instead of chasing a
	// moving target. Production keeps a real allow-list (comma-separated).
	trustedOrigins: async (request) => {
		if (dev) return ['https://*:5173', 'http://*:5173'];
		const asked = request?.headers.get('origin');
		return [
			...(env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',')
				.map((s) => s.trim())
				.filter(Boolean) ?? []),
			// The sites of games built on the engine: the ones listed, and the ones an app registered to run on (see lib/server/cors.ts).
			...parseAllowedOrigins(env.ENGINE_ALLOWED_ORIGINS),
			...(asked && (await appAllowsOrigin(asked)) ? [asked] : [])
		];
	},
	database: prismaAdapter(prisma, {
		provider: 'postgresql'
	}),
	emailAndPassword: {
		enabled: true
	},
	// Account deletion cascades through every user-owned table (see prisma/schema.prisma); freed models are reclaimed by the asset cleanup.
	user: { deleteUser: { enabled: true } },
	// Settings → Connections lists sessions and unlinks accounts; both require a "fresh" session,
	// which would otherwise 403 for anyone signed in more than a day ago.
	session: { freshAge: 0 },
	// A signed-in user explicitly linking Discord may use a different email there.
	account: { accountLinking: { allowDifferentEmails: true } },
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
	// `role` is stored as a comma-separated string ("admin,moderator"); a user is an admin when any of their roles is listed in adminRoles.
	plugins: [
		username(),
		admin({ adminRoles: ['admin'], defaultRole: 'user' }),
		// A game on another site signs in with a token instead of a cookie. It says who it is with its app id (or a published world's id).
		bearer(),
		deviceAuthorization({
			verificationUri: '/device',
			expiresIn: '10m',
			interval: '5s',
			validateClient: async (clientId) => clientId === ENGINE_CLIENT_ID || Boolean(await prisma.publishedWorld.findUnique({ where: { id: clientId }, select: { id: true } }))
		}),
		sveltekitCookies(getRequestEvent)
	]
});
