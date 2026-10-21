import type { PageServerLoad } from './$types';
import { getPublishedWorldApp } from '$lib/server/services/publications';
import { describeWorldApp, worldAppPath } from '$lib/worlds/appManifest';
import { recordWorldVisit } from '$lib/server/services/homeFeed';
import { toHttpError } from '$lib/server/apiError';
import { getBuiltinWorld } from '$lib/content/templates/builtinWorlds';

export const load: PageServerLoad = async ({ params, locals }) => {
	// A built-in world opens directly by its id (for development and testing); it is not an installable app.
	const builtin = getBuiltinWorld(params.worldId);
	if (builtin) return { worldId: params.worldId, app: { name: builtin.name, description: builtin.description, themeColor: undefined, manifestHref: undefined } };
	try {
		const app = await getPublishedWorldApp(params.worldId);
		if (locals.user) void recordWorldVisit(locals.user.id, params.worldId);
		const descriptor = describeWorldApp(app.worldName, app.info);
		return {
			worldId: params.worldId,
			app: { name: descriptor.name, description: descriptor.description, themeColor: descriptor.themeColor, manifestHref: `${worldAppPath(params.worldId)}/manifest.webmanifest` }
		};
	} catch (err) {
		toHttpError(err);
	}
};
