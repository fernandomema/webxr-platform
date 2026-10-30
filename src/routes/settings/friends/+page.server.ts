import type { PageServerLoad } from './$types';
import { getFriendsOverview, getMyFriendCode, listBlockedUsers } from '$lib/server/services/friends';

export const load: PageServerLoad = async ({ locals }) => {
	const [overview, code, blocked] = await Promise.all([getFriendsOverview(locals.user), getMyFriendCode(locals.user), listBlockedUsers(locals.user)]);
	return { overview, code: code.code, blocked };
};
