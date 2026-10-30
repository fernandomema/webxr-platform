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
	const worldStorageItems = await prisma.worldPlayerItem.findMany({ where: { accountId: userId } });
	const [profile, accounts, sessions, worlds, worldSessions, worldInventoryFolders, worldInventoryItems, cloudFolders, cloudItems, publications, publicationRevisions, marketplaceItems, marketplaceRevisions, purchases, assets, feedbackEntries, feedbackVotes, feedbackInteractions, moodResponses, creditAccount, creditTransactions, productEntitlements, paymentIdentities, friendships, friendRequests, blocks, externalLinks] = await Promise.all([
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
		prisma.feedbackMoodResponse.findMany({ where: { userId } }),
		prisma.creditAccount.findUnique({ where: { userId } }),
		prisma.creditTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
		prisma.productEntitlement.findMany({ where: { userId } }),
		prisma.paymentIdentity.findMany({ where: { userId } }),
		prisma.friendship.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } }),
		prisma.friendRequest.findMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } }),
		prisma.userBlock.findMany({ where: { blockerId: userId } }),
		prisma.externalFriendLink.findMany({ where: { userId } })
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
		/** Objects published worlds keep for this account when it hosts them, if it chose to keep them in the cloud. */
		worldStorageItems,
		publishedWorlds: { publications, revisions: publicationRevisions },
		marketplace: { items: marketplaceItems, revisions: marketplaceRevisions, purchases },
		models: assets,
		feedback: { entries: feedbackEntries, votes: feedbackVotes, interactions: feedbackInteractions, moodResponses },
		/** Credits: the balance, every movement of it (with the provider's payment reference), what was bought in worlds, and the store accounts (Meta user id) linked to this account. Card details are held by Stripe, never by Kithin. */
		credits: { account: creditAccount, transactions: creditTransactions, productEntitlements, linkedStoreAccounts: paymentIdentities },
		/** Friends: your friend code, who you are friends with, open requests, people you blocked, and the platform accounts (Meta Quest) linked to find friends. Only ids are listed for other people. */
		friends: { friendCode: profile?.friendCode ?? null, friendships, requests: friendRequests, blocked: blocks, linkedPlatformAccounts: externalLinks }
	};
}
