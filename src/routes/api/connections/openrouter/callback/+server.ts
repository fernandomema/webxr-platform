import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { exchangeCode, saveOpenRouterKey } from '$lib/server/openrouterConnection';

export const GET: RequestHandler = async ({ locals, url, cookies }) => {
	if (!locals.user) error(401, 'Unauthorized');
	const raw = cookies.get('openrouter_oauth');
	cookies.delete('openrouter_oauth', { path: '/api/connections/openrouter' });
	let flow: { verifier?: string; state?: string; returnTo?: string } = {};
	try { flow = JSON.parse(raw ?? '{}'); } catch { /* treated as a missing flow below */ }
	const returnTo = flow.returnTo?.startsWith('/') && !flow.returnTo.startsWith('//') ? flow.returnTo : '/settings/connections';
	const code = url.searchParams.get('code');
	// OpenRouter echoes `state` back only if it supports it; when present it must match.
	const echoed = url.searchParams.get('state');
	if (!code || !flow.verifier || !flow.state || (echoed && echoed !== flow.state)) redirect(303, `${returnTo}?openrouter=failed`);
	try { await saveOpenRouterKey(locals.user.id, await exchangeCode(code, flow.verifier)); }
	catch { redirect(303, `${returnTo}?openrouter=failed`); }
	redirect(303, `${returnTo}?openrouter=connected`);
};
