import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';

/**
 * Dev-only sink for src/lib/devConsoleRelay.ts — lets browser console
 * errors/warnings from a device with no attached devtools (a VR headset)
 * show up in this terminal instead.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!dev) return json({ ok: false }, { status: 404 });

	const body = (await request.json()) as { level: string; message: string; url: string };
	const tag = body.level === 'error' ? '\x1b[31m[quest error]\x1b[0m' : '\x1b[33m[quest warn]\x1b[0m';
	console.log(`${tag} ${body.url}\n${body.message}`);

	return json({ ok: true });
};
