import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleProviderWebhook } from '$lib/server/services/credits';
import { NotFoundError } from '$lib/server/errors';

/** Payment providers call this with a signed notification; nothing here trusts the caller beyond that signature. */
export const POST: RequestHandler = async ({ params, request }) => {
	const rawBody = await request.text();
	if (rawBody.length > 200_000) error(413, 'Too large');
	try {
		return json(await handleProviderWebhook(params.provider, rawBody, request.headers));
	} catch (err) {
		if (err instanceof NotFoundError) error(404, 'Not found');
		if (err instanceof Error && err.message === 'Invalid signature') error(400, 'Invalid signature');
		throw err;
	}
};
