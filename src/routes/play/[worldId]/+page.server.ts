import type { PageServerLoad } from './$types';
import { getPublishedWorldApp } from '$lib/server/services/publications';
import { describeWorldApp, worldAppPath } from '$lib/worlds/appManifest';
import { toHttpError } from '$lib/server/apiError';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const app = await getPublishedWorldApp(params.worldId);
		const descriptor = describeWorldApp(app.worldName, app.info);
		return {
			worldId: params.worldId,
			app: { name: descriptor.name, description: descriptor.description, themeColor: descriptor.themeColor, manifestHref: `${worldAppPath(params.worldId)}/manifest.webmanifest` }
		};
	} catch (err) {
		toHttpError(err);
	}
};
