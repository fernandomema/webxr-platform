import { error, json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { challengeFor, createPkce, deleteOpenRouterKey, hasOpenRouterKey } from '$lib/server/openrouterConnection';

const COOKIE = 'openrouter_oauth';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	return json({ connected: await hasOpenRouterKey(locals.user.id) }, { headers: { 'cache-control': 'no-store' } });
};

/** Starts the PKCE flow: remembers verifier + state in a short-lived cookie and sends the user to OpenRouter. */
export const POST: RequestHandler = async ({ locals, url, cookies, request }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const form = await request.formData().catch(() => null);
	const returnTo = String(form?.get('returnTo') ?? '/settings/connections');
	const { verifier, state } = createPkce();
	cookies.set(COOKIE, JSON.stringify({ verifier, state, returnTo: returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/settings/connections' }), {
		path: '/api/connections/openrouter', httpOnly: true, sameSite: 'lax', secure: url.protocol === 'https:', maxAge: 600
	});
	const auth = new URL('https://openrouter.ai/auth');
	auth.searchParams.set('callback_url', `${url.origin}/api/connections/openrouter/callback`);
	auth.searchParams.set('code_challenge', await challengeFor(verifier));
	auth.searchParams.set('code_challenge_method', 'S256');
	auth.searchParams.set('state', state);
	auth.searchParams.set('key_label', 'Kithin');
	redirect(303, auth.toString());
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized');
	await deleteOpenRouterKey(locals.user.id);
	return json({ connected: false });
};
