import type { RequestHandler } from './$types';
import { getLibrary } from '$lib/server/library/registry';
import { limitedBy, respond } from '$lib/server/library/api';

/** One file of one variant, through the source's host allowlist and a size cap. The address is the source's own, never the request's. */
export const GET: RequestHandler = ({ params, url, locals, getClientAddress, request }) => respond(async () => {
	limitedBy(locals, getClientAddress, 'file', 40);
	const index = Number(url.searchParams.get('index') ?? 0);
	const { bytes, contentType, filename } = await getLibrary().file(params.ref, url.searchParams.get('variant') ?? '', url.searchParams.get('role') ?? '', Number.isInteger(index) ? index : 0, request.signal);
	return new Response(bytes as BodyInit, { headers: { 'content-type': contentType, 'content-length': String(bytes.byteLength), 'content-disposition': `inline; filename="${filename}"`, 'cache-control': 'private, max-age=3600' } });
});
