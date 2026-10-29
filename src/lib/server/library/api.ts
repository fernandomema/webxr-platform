import { json } from '@sveltejs/kit';
import { takeRateToken } from '../rateLimit';
import { LibraryError } from './http';

/**
 * Signing in is not needed to use the library (a project on this device imports without an account), so the limit is per person
 * when signed in and per address otherwise.
 */
export function limitedBy(locals: App.Locals, getClientAddress: () => string, kind: 'search' | 'file', perMinute: number): void {
	let who: string;
	try { who = locals.user?.id ?? getClientAddress(); } catch { who = 'unknown'; }
	if (!takeRateToken(`library-${kind}:${who}`, perMinute)) throw new LibraryError(429, 'Too many requests. Try again in a moment.');
}

export async function respond(run: () => Promise<Response>): Promise<Response> {
	try { return await run(); }
	catch (error) {
		if (error instanceof LibraryError) return json({ message: error.message }, { status: error.status });
		console.error('[library] request failed', error);
		return json({ message: 'The library could not answer right now.' }, { status: 502 });
	}
}
