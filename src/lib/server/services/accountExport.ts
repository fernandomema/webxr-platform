import { prisma } from '../db';
import { UnauthorizedError } from '../errors';
import type { SessionUser } from './worlds';

/**
 * Everything the platform stores about a user, as plain JSON (GDPR data portability).
 * Secrets are left out on purpose: password hashes, OAuth/OpenRouter tokens and session tokens.
 * Model files themselves live in object storage; they are listed here by id with their metadata.
 */
export async function exportAccountData(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const userId = user.id;
	const [profile, accounts, sessions, worlds, worldSessions, worldInventoryFolders, worldInventoryItems, cloudFolders, cloudItems, publications, publicationRevisions, marketplaceItems, marketplaceRevisions, purchases, assets, feedbackEntries, feedbackVotes, feedbackInteractions, moodResponses] = await Promise.all([
		prisma.user.findUnique({ where: { id: userId } }),
		prisma.account.findMany({ where: { userId }, select: { providerId: true, accountId: true, createdAt: true } }),
		prisma.session.findMany({ where: { userId }, select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true } }),
		prisma.world.findMany({ where: { hostUserId: userId } }),
		prisma.worldSession.findMany({ where: { hostUserId: userId } }),
		prisma.worldInventoryFolder.findMany({ where: { world: { hostUserId: userId } } }),
		prisma.worldInventoryItem.findMany({ where: { world: { hostUserId: userId } } }),
		prisma.cloudInventoryFolder.findMany({ where: { ownerId: userId } }),
		prisma.cloudInventoryItem.findMany({ where: { ownerId: userId } }),
		prisma.publishedWorld.findMany({ where: { ownerId: userId } }),
		prisma.publishedWorldRevision.findMany({ where: { publication: { ownerId: userId } } }),
		prisma.marketplaceItem.findMany({ where: { ownerId: userId } }),
		prisma.marketplaceItemRevision.findMany({ where: { marketplaceItem: { ownerId: userId } } }),
		prisma.marketplacePurchase.findMany({ where: { userId } }),
		prisma.assetOwner.findMany({ where: { ownerId: userId }, select: { assetId: true, name: true, source: true, createdAt: true, asset: { select: { byteSize: true, mimeType: true, format: true, manifest: true } } } }),
		prisma.feedbackEntry.findMany({ where: { userId } }),
		prisma.feedbackVote.findMany({ where: { userId } }),
		prisma.feedbackInteraction.findMany({ where: { userId } }),
		prisma.feedbackMoodResponse.findMany({ where: { userId } })
	]);
	return {
		exportedAt: new Date().toISOString(),
		profile,
		linkedAccounts: accounts,
		sessions,
		worlds,
		worldSessions,
		worldInventory: { folders: worldInventoryFolders, items: worldInventoryItems },
		cloudInventory: { folders: cloudFolders, items: cloudItems },
		publishedWorlds: { publications, revisions: publicationRevisions },
		marketplace: { items: marketplaceItems, revisions: marketplaceRevisions, purchases },
		models: assets,
		feedback: { entries: feedbackEntries, votes: feedbackVotes, interactions: feedbackInteractions, moodResponses }
	};
}
