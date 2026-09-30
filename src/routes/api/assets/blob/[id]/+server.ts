import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { openAssetForReading, receiveProxyUpload } from '$lib/server/services/assets';
import { toHttpError } from '$lib/server/apiError';

// Only used when uploads/downloads go through this server (an http S3 endpoint behind an https site).
// With an https endpoint the browser talks to S3 directly and these are never called.

const maxBytes = () => Number(env.ASSET_MAX_BYTES ?? 26_214_400);

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		if (Number(request.headers.get('content-length') ?? 0) > maxBytes()) return json({ message: 'The asset is too large.' }, { status: 413 });
		if (!request.body) return json({ message: 'Missing file.' }, { status: 400 });
		// Read with a running cap so an oversized or lying Content-Length cannot exhaust memory.
		const reader = request.body.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes()) {
				await reader.cancel();
				return json({ message: 'The asset is too large.' }, { status: 413 });
			}
			chunks.push(value);
		}
		await receiveProxyUpload(locals.user, params.id, Buffer.concat(chunks));
		return new Response(null, { status: 204 });
	} catch (err) {
		toHttpError(err);
	}
};

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { stream, size, mimeType } = await openAssetForReading(locals.user, params.id);
		return new Response(stream, {
			headers: {
				'content-type': mimeType,
				// The address is the hash of the content, so a cached copy can never be stale.
				'cache-control': 'private, max-age=31536000, immutable',
				...(size !== undefined ? { 'content-length': String(size) } : {})
			}
		});
	} catch (err) {
		toHttpError(err);
	}
};
