import { prisma } from '../db';
import { BadRequestError, NotFoundError, UnauthorizedError, ConflictError } from '../errors';
import { migrateSlotTree } from '@kithin/engine/assets/ref';
import { WORLD_ITEM_KEY, WORLD_ITEM_LIMITS } from '@kithin/engine/worldStorage/items';
import { validateExternalTree } from '@kithin/engine/inventory/external';
import { assertAssetsReady, assertInventoryQuota, linkSceneAssets, resolveThumbnail, withThumbnail } from './assets';
import type { SlotTree } from '@kithin/engine/ecs/types';
import type { SessionUser } from './worlds';

/**
 * Objects a published world keeps for the person who hosts it, in the cloud. They belong to the signed-in account and count in its
 * storage (the objects' data and the models they use); the world's creator pays nothing for what players keep.
 */

const sceneBytes = (scene: unknown) => Buffer.byteLength(JSON.stringify(scene));

function view(item: { id: string; key: string | null; name: string; slotData: unknown; thumbnailAssetId: string | null; createdAt: Date }) {
	return { id: item.id, key: item.key, name: item.name, slotData: migrateSlotTree(item.slotData as unknown as SlotTree), thumbnailAssetId: item.thumbnailAssetId, createdAt: item.createdAt.toISOString() };
}

async function assertPublication(publicationId: string) {
	if (!(await prisma.publishedWorld.findUnique({ where: { id: publicationId }, select: { id: true } }))) throw new NotFoundError();
}

export async function listWorldPlayerItems(user: SessionUser | null, publicationId: string, key?: string | null) {
	if (!user) throw new UnauthorizedError();
	const items = await prisma.worldPlayerItem.findMany({
		where: { publicationId, accountId: user.id, ...(key ? { key } : {}) },
		orderBy: { createdAt: 'desc' }
	});
	return items.map(view);
}

export async function getWorldPlayerItem(user: SessionUser | null, publicationId: string, itemId: string) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.worldPlayerItem.findUnique({ where: { id: itemId } });
	// Someone else's object, another world's, and one that does not exist are all the same.
	if (!item || item.accountId !== user.id || item.publicationId !== publicationId) throw new NotFoundError();
	return view(item);
}

interface ItemInput {
	key?: unknown;
	name?: unknown;
	slotData?: unknown;
	thumbnailAssetId?: unknown;
}

function clean(input: ItemInput) {
	if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > WORLD_ITEM_LIMITS.maxNameLength) throw new BadRequestError('Invalid name');
	if (input.key != null && (typeof input.key !== 'string' || !WORLD_ITEM_KEY.test(input.key))) throw new BadRequestError('Invalid key');
	let scene: SlotTree;
	try {
		scene = migrateSlotTree(validateExternalTree(input.slotData));
	} catch (err) {
		throw new BadRequestError(err instanceof Error ? err.message : 'Invalid object');
	}
	if (sceneBytes(scene) > WORLD_ITEM_LIMITS.maxBytes) throw new BadRequestError('The object is too large to keep');
	return { name: input.name.trim(), key: (input.key as string | null | undefined) ?? null, scene };
}

/** Creates the object, or replaces the one the account already keeps under the same key. */
export async function saveWorldPlayerItem(user: SessionUser | null, publicationId: string, input: ItemInput, itemId?: string) {
	if (!user) throw new UnauthorizedError();
	await assertPublication(publicationId);
	const data = clean(input);
	return prisma.$transaction(async (tx) => {
		const existing = itemId
			? await tx.worldPlayerItem.findUnique({ where: { id: itemId } })
			: data.key ? await tx.worldPlayerItem.findUnique({ where: { publicationId_accountId_key: { publicationId, accountId: user.id, key: data.key } } }) : null;
		if (itemId && (!existing || existing.accountId !== user.id || existing.publicationId !== publicationId)) throw new NotFoundError();
		if (!existing && (await tx.worldPlayerItem.count({ where: { publicationId, accountId: user.id } })) >= WORLD_ITEM_LIMITS.maxItems) {
			throw new ConflictError(`At most ${WORLD_ITEM_LIMITS.maxItems} objects can be kept per world`);
		}
		const assetIds = await assertAssetsReady(tx, data.scene);
		const thumbnail = await resolveThumbnail(tx, input.thumbnailAssetId, existing?.thumbnailAssetId ?? null);
		await assertInventoryQuota(tx, user.id, sceneBytes(data.scene) - (existing ? sceneBytes(existing.slotData) : 0));
		const fields = { name: data.name, slotData: data.scene as object, thumbnailAssetId: thumbnail, ...(itemId || !existing ? { key: data.key } : {}) };
		const item = existing
			? await tx.worldPlayerItem.update({ where: { id: existing.id }, data: fields })
			: await tx.worldPlayerItem.create({ data: { publicationId, accountId: user.id, ...fields } });
		await linkSceneAssets(tx, user, { kind: 'worldPlayerItem', id: item.id }, withThumbnail(assetIds, thumbnail));
		return view(item);
	});
}

export async function deleteWorldPlayerItem(user: SessionUser | null, publicationId: string, itemId: string) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.worldPlayerItem.findUnique({ where: { id: itemId } });
	if (!item || item.accountId !== user.id || item.publicationId !== publicationId) throw new NotFoundError();
	await prisma.worldPlayerItem.delete({ where: { id: itemId } });
}

/** What the account keeps in the cloud per published world, for the page where it manages that. */
export async function worldItemUsage(user: SessionUser | null) {
	if (!user) throw new UnauthorizedError();
	const items = await prisma.worldPlayerItem.findMany({ where: { accountId: user.id }, select: { publicationId: true, slotData: true, publication: { select: { name: true } } } });
	const byWorld = new Map<string, { publicationId: string; name: string; items: number; bytes: number }>();
	for (const item of items) {
		const row = byWorld.get(item.publicationId) ?? { publicationId: item.publicationId, name: item.publication.name, items: 0, bytes: 0 };
		row.items++;
		row.bytes += sceneBytes(item.slotData);
		byWorld.set(item.publicationId, row);
	}
	return [...byWorld.values()].sort((a, b) => b.bytes - a.bytes);
}

/** Removes everything the account keeps for one published world. The models it used are let go by the cleanup once nothing references them. */
export async function clearWorldPlayerItems(user: SessionUser | null, publicationId: string) {
	if (!user) throw new UnauthorizedError();
	const items = await prisma.worldPlayerItem.findMany({ where: { publicationId, accountId: user.id }, select: { id: true } });
	await prisma.worldPlayerItem.deleteMany({ where: { publicationId, accountId: user.id } });
	return items.length;
}
