import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { admin, username } from 'better-auth/plugins';
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
	plugins: [username(), admin({ adminRoles: ['admin'], defaultRole: 'user' }), sveltekitCookies(getRequestEvent)]
});
