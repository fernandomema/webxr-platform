import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** The page a game sends someone to when it asks to sign in with a code: only for people who are signed in here. */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(`/device${url.search}`)}`);
	return { userName: locals.user.name };
};
