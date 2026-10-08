import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** `role` is a comma-separated list ("admin,moderator"); see the admin plugin in $lib/auth. */
const isAdmin = (role: string | null | undefined) => (role ?? '').split(',').some((r) => r.trim() === 'admin');

// Guards every route under /admin. Child page loads run in parallel with this one, but a redirect/error thrown here wins the response.
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	if (locals.user.banned || !isAdmin(locals.user.role)) error(403, 'Admins only');
	return { admin: { name: locals.user.name, email: locals.user.email, image: locals.user.image ?? null } };
};
