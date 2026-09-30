import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchPolyHaven } from '$lib/server/polyHaven';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const page = Number(url.searchParams.get('page') ?? 0);
		return json(await searchPolyHaven(url.searchParams.get('q') ?? '', Number.isInteger(page) ? page : 0));
	} catch (error) {
		console.error('[polyhaven] search failed', error);
		return json({ message: 'Could not search Poly Haven right now.' }, { status: 502 });
	}
};
