import type { PageServerLoad } from './$types';
import { hasOpenRouterKey } from '$lib/server/openrouterConnection';

export const load: PageServerLoad = async ({ locals, url }) => ({
	openrouter: await hasOpenRouterKey(locals.user!.id),
	notice: url.searchParams.get('openrouter')
});
