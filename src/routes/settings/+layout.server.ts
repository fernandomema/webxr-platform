import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	return {
		user: { name: locals.user.name, email: locals.user.email, username: locals.user.username ?? null, image: locals.user.image ?? null },
		sessionToken: locals.session?.token ?? null,
		discordEnabled: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
	};
};
