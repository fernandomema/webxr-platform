import type { PageServerLoad } from './$types';
import { BUILTIN_WORLDS, DEV_WORLD_IDS } from '$lib/xr/templates/builtinWorlds';
import { listPublications } from '$lib/server/services/publications';

export const load: PageServerLoad = async () => {
	const worlds = await listPublications();
	return {
		// Only the card's text goes to the page: the scenes stay on the server, they are large.
		official: BUILTIN_WORLDS.filter((world) => !DEV_WORLD_IDS.includes(world.id)).map((world) => ({ id: world.id, name: world.name, description: world.description })),
		worlds: worlds.map((world) => ({
			id: world.id,
			name: world.name,
			latestRevision: world.latestRevision,
			thumbnailAssetId: world.thumbnailAssetId,
			updatedAt: world.updatedAt.toISOString()
		}))
	};
};
