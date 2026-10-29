import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLibrary } from '$lib/server/library/registry';
import { limitedBy, respond } from '$lib/server/library/api';

export const GET: RequestHandler = ({ url, locals, getClientAddress, request }) => respond(async () => {
	limitedBy(locals, getClientAddress, 'search', 60);
	const params = url.searchParams;
	const result = await getLibrary().search({
		source: params.get('source') ?? 'all',
		kind: params.get('kind') ?? '',
		text: params.get('q') ?? '',
		cursor: params.get('cursor') ?? undefined,
		limit: params.has('limit') ? Number(params.get('limit')) : undefined,
		filters: { commercialOnly: params.get('commercial') !== 'false', importableOnly: params.get('importable') !== 'false', ...(params.get('category') ? { category: params.get('category')!.slice(0, 60) } : {}) }
	}, request.signal);
	return json(result, { headers: { 'cache-control': 'private, max-age=300' } });
});
