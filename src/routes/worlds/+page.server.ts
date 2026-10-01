import type { PageServerLoad } from './$types';
import { listPublications } from '$lib/server/services/publications';

export const load: PageServerLoad = async () => {
	const worlds = await listPublications();
	return {
		worlds: worlds.map((world) => ({
			id: world.id,
			name: world.name,
			latestRevision: world.latestRevision,
			thumbnailAssetId: world.thumbnailAssetId,
			updatedAt: world.updatedAt.toISOString()
		}))
	};
};
