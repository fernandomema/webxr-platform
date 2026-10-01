import type { RequestHandler } from './$types';
import { getPublishedWorldApp } from '$lib/server/services/publications';
import { buildWorldManifest, describeWorldApp } from '$lib/worlds/appManifest';
import { toHttpError } from '$lib/server/apiError';

/** The web app manifest that turns a published world into its own installable app. */
export const GET: RequestHandler = async ({ params }) => {
	try {
		const app = await getPublishedWorldApp(params.worldId);
		const manifest = buildWorldManifest(app.publicationId, describeWorldApp(app.worldName, app.info), app.revisionId);
		return new Response(JSON.stringify(manifest), {
			headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=300' }
		});
	} catch (err) {
		toHttpError(err);
	}
};
