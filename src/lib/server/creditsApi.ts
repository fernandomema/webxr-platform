import { json } from '@sveltejs/kit';
import { CreditError } from './errors';
import { toHttpError } from './apiError';

/** A credits rule that stopped a charge answers with its code, so the client can tell the player why; everything else is an ordinary API error. */
export function creditsError(err: unknown): never | Response {
	if (err instanceof CreditError) return json({ ok: false, code: err.code, message: err.message }, { status: 409 });
	return toHttpError(err);
}

export async function readJson(request: Request): Promise<unknown> {
	try { return await request.json(); } catch { return null; }
}
