import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeUpload } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

/** Step 2: the bytes are in storage; verify them and make the model available. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const body = (await request.json()) as { assetId?: unknown };
		await completeUpload(locals.user, String(body.assetId ?? ''));
		return json({ ok: true });
	} catch (err) {
		toHttpError(err);
	}
};
