import { prisma } from '$lib/server/db';
import { assetUsage, listMyAssets } from '$lib/server/services/assets';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const userId = user.id;
	const [usage, assets, worlds, published, inventoryItems, inventoryFolders, marketplaceItems, purchases, sessions] = await Promise.all([
		assetUsage(user),
		listMyAssets(user),
		prisma.world.count({ where: { hostUserId: userId } }),
		prisma.publishedWorld.count({ where: { ownerId: userId } }),
		prisma.cloudInventoryItem.count({ where: { ownerId: userId } }),
		prisma.cloudInventoryFolder.count({ where: { ownerId: userId } }),
		prisma.marketplaceItem.count({ where: { ownerId: userId } }),
		prisma.marketplacePurchase.count({ where: { userId } }),
		prisma.worldSession.count({ where: { hostUserId: userId, endedAt: null } })
	]);
	const largest = [...assets]
		.sort((a, b) => b.byteSize - a.byteSize)
		.slice(0, 10)
		.map((asset) => ({ assetId: asset.assetId, name: asset.name, byteSize: asset.byteSize, source: asset.source, inUse: asset.usedIn.items + asset.usedIn.worlds + asset.usedIn.publications > 0 }));
	return { usage, largest, counts: { worlds, published, inventoryItems, inventoryFolders, marketplaceItems, purchases, sessions } };
};
