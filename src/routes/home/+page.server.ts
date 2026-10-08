import type { PageServerLoad } from './$types';
import { newestWorlds, popularWorlds, recentlyVisited, staffPicks } from '$lib/server/services/homeFeed';

/** A section that fails to load is simply left out; the launcher must always render. */
const safe = <T>(job: Promise<T[]>): Promise<T[]> => job.catch(() => []);

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user?.id;
	const [visited, popular, picks, newest] = await Promise.all([
		userId ? safe(recentlyVisited(userId)) : [],
		safe(popularWorlds()),
		safe(staffPicks()),
		safe(newestWorlds())
	]);
	return {
		user: locals.user ? { id: locals.user.id, name: locals.user.name, image: locals.user.image ?? null } : null,
		visited, popular, picks, newest
	};
};
