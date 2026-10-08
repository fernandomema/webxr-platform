import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { hasOpenRouterKey } from '$lib/server/openrouterConnection';

export const load: PageServerLoad = async ({ locals, url }) => ({
	openrouter: await hasOpenRouterKey(locals.user!.id),
	notice: url.searchParams.get('openrouter'),
	discordError: url.searchParams.get('error'),
	discordNotice: url.searchParams.get('discord'),
	discordEnabled: Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET)
});
