import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { polyHavenGlb } from '$lib/server/polyHaven';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const bytes = await polyHavenGlb(params.id);
		return new Response(bytes as BodyInit, {
			headers: {
			'content-type': 'model/gltf-binary',
			'content-length': String(bytes.byteLength),
			'cache-control': 'private, max-age=3600'
			}
		});
	} catch (error) {
		const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 502;
		if (status === 502) console.error('[polyhaven] import failed', error);
		return json({ message: error instanceof Error ? error.message : 'Could not import this model.' }, { status });
	}
};
