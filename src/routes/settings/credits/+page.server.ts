import type { PageServerLoad } from './$types';
import { getCreditsSummary } from '$lib/server/services/credits';

export const load: PageServerLoad = async ({ locals, url }) => ({
	summary: await getCreditsSummary(locals.user),
	payment: url.searchParams.get('payment')
});
