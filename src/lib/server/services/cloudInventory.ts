import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError } from '../errors';
import { validateWorldScene } from '@kithin/engine/worlds/package';
import { migrateSlotTree } from '@kithin/engine/assets/ref';
import { MAX_FOLDER_DEPTH, isInventoryVisibility, isPubliclyReadable, type InventoryVisibility } from '@kithin/engine/inventory/visibility';
import { assertAssetsReady, assertInventoryQuota, linkSceneAssets, resolveThumbnail, withThumbnail } from './assets';
import type { SlotTree } from '@kithin/engine/ecs/types';
import type { SessionUser } from './worlds';

/** The name and parent a rename/move request may set; anything left out is not touched. */
export function cleanChanges(changes: { name?: unknown } & Record<string, unknown>, parentKey: 'parentId' | 'folderId') {
	const data: { name?: string; parentId?: string | null; folderId?: string | null } = {};
	if (changes.name !== undefined) {
		if (typeof changes.name !== 'string' || !changes.name.trim() || changes.name.length > 120) throw new BadRequestError('Invalid name');
		data.name = changes.name.trim();
	}
	const parent = changes[parentKey];
	if (parent !== undefined) {
		if (parent !== null && typeof parent !== 'string') throw new BadRequestError('Invalid folder');
		data[parentKey] = parent;
	}
	return data;
}

/** The visibility a request may set on a cloud folder or item; left out, it is not touched. */
export function cleanVisibility(changes: { visibility?: unknown }): { visibility?: InventoryVisibility } {
	if (changes.visibility === undefined) return {};
	if (!isInventoryVisibility(changes.visibility)) throw new BadRequestError('Invalid visibility');
	return { visibility: changes.visibility };
}

/** A folder cannot be moved under itself or any of its own subfolders. */
export function assertNotInside(folderId: string, targetId: string, folders: { id: string; parentId: string | null }[]) {
	const parentOf = new Map(folders.map((entry) => [entry.id, entry.parentId]));
	for (let at: string | null | undefined = targetId; at; at = parentOf.get(at)) {
		if (at === folderId) throw new BadRequestError('A folder cannot go inside itself');
	}
}

const sceneBytes = (scene: unknown) => Buffer.byteLength(JSON.stringify(scene));

export async function listCloudFolders(user: SessionUser | null, parentId: string | null) {
	if (!user) throw new UnauthorizedError();
	return prisma.cloudInventoryFolder.findMany({
		where: { ownerId: user.id, parentId },
		orderBy: { name: 'asc' }
	});
}

export async function createCloudFolder(user: SessionUser | null, parentId: string | null, name: string) {
	if (!user) throw new UnauthorizedError();
	return prisma.cloudInventoryFolder.create({
		data: { ownerId: user.id, parentId, name }
	});
}

export async function updateCloudFolder(user: SessionUser | null, folderId: string, changes: { name?: unknown; parentId?: unknown; visibility?: unknown }) {
	if (!user) throw new UnauthorizedError();
	const folder = await prisma.cloudInventoryFolder.findUnique({ where: { id: folderId } });
	if (!folder) throw new NotFoundError();
	if (folder.ownerId !== user.id) throw new ForbiddenError();
	const data = { ...cleanChanges(changes, 'parentId'), ...cleanVisibility(changes) };
	if (data.parentId) {
		const parents = await prisma.cloudInventoryFolder.findMany({ where: { ownerId: user.id }, select: { id: true, parentId: true } });
		assertNotInside(folderId, data.parentId, parents);
	}
	return prisma.cloudInventoryFolder.update({ where: { id: folderId }, data });
}

export async function deleteCloudFolder(user: SessionUser | null, folderId: string) {
	if (!user) throw new UnauthorizedError();
	const folder = await prisma.cloudInventoryFolder.findUnique({ where: { id: folderId } });
	if (!folder) throw new NotFoundError();
	if (folder.ownerId !== user.id) throw new ForbiddenError();
	await prisma.cloudInventoryFolder.delete({ where: { id: folderId } });
}

export async function listCloudItems(user: SessionUser | null, folderId: string | null) {
	if (!user) throw new UnauthorizedError();
	return prisma.cloudInventoryItem.findMany({
		where: { ownerId: user.id, folderId },
		orderBy: { createdAt: 'desc' }
	});
}

export async function saveCloudItem(
	user: SessionUser | null,
	folderId: string | null,
	name: string,
	slotData: SlotTree,
	kind: 'object' | 'world' | 'avatar' = 'object',
	worldLineageId?: string,
	thumbnailAssetId?: unknown
) {
	if (!user) throw new UnauthorizedError();
	if (kind === 'world') {
		try { validateWorldScene(slotData); } catch (err) { throw new BadRequestError(err instanceof Error ? err.message : 'Invalid world scene'); }
		const lineage = worldLineageId ?? randomUUID();
		if (!/^[a-zA-Z0-9_-]{1,64}$/.test(lineage)) throw new BadRequestError('Invalid world lineage');
		return prisma.$transaction(async (tx) => {
			const latest = await tx.cloudInventoryItem.findFirst({
				where: { ownerId: user.id, worldLineageId: lineage, kind: 'world' },
				orderBy: { revisionNumber: 'desc' }, select: { revisionNumber: true }
			});
			const scene = migrateSlotTree(slotData);
			const assetIds = await assertAssetsReady(tx, scene);
			const thumbnail = await resolveThumbnail(tx, thumbnailAssetId, null);
			await assertInventoryQuota(tx, user.id, sceneBytes(scene));
			const item = await tx.cloudInventoryItem.create({ data: {
				ownerId: user.id, folderId, name, slotData: scene as object, thumbnailAssetId: thumbnail,
				kind, worldLineageId: lineage, revisionNumber: (latest?.revisionNumber ?? 0) + 1
			} });
			await linkSceneAssets(tx, user, { kind: 'cloudItem', id: item.id }, withThumbnail(assetIds, thumbnail));
			return item;
		});
	}
	return prisma.$transaction(async (tx) => {
		const scene = migrateSlotTree(slotData);
		const assetIds = await assertAssetsReady(tx, scene);
		const thumbnail = await resolveThumbnail(tx, thumbnailAssetId, null);
		await assertInventoryQuota(tx, user.id, sceneBytes(scene));
		const item = await tx.cloudInventoryItem.create({ data: { ownerId: user.id, folderId, name, slotData: scene as object, thumbnailAssetId: thumbnail, kind } });
		await linkSceneAssets(tx, user, { kind: 'cloudItem', id: item.id }, withThumbnail(assetIds, thumbnail));
		return item;
	});
}

export async function deleteCloudItem(user: SessionUser | null, itemId: string) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.cloudInventoryItem.findUnique({ where: { id: itemId } });
	if (!item) throw new NotFoundError();
	if (item.ownerId !== user.id) throw new ForbiddenError();
	await prisma.cloudInventoryItem.delete({ where: { id: itemId } });
}

export async function updateCloudItemInfo(user: SessionUser | null, itemId: string, changes: { name?: unknown; folderId?: unknown; visibility?: unknown }) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.cloudInventoryItem.findUnique({ where: { id: itemId } });
	if (!item) throw new NotFoundError();
	if (item.ownerId !== user.id) throw new ForbiddenError();
	const data = { ...cleanChanges(changes, 'folderId'), ...cleanVisibility(changes) };
	if (data.folderId) {
		const target = await prisma.cloudInventoryFolder.findUnique({ where: { id: data.folderId } });
		if (!target || target.ownerId !== user.id) throw new NotFoundError();
	}
	return prisma.cloudInventoryItem.update({ where: { id: itemId }, data });
}

/**
 * An object anyone may read: public itself, or inside a public folder. Anything else, including an id that does not exist,
 * is the same "not found", so a private item cannot be told apart from a missing one. The folder structure is not exposed.
 */
export async function readPublicCloudItem(itemId: string) {
	const item = await prisma.cloudInventoryItem.findUnique({ where: { id: itemId } });
	if (!item || item.kind !== 'object') throw new NotFoundError();
	const chain: Array<{ visibility: string }> = [];
	const seen = new Set<string>();
	for (let at = item.folderId; at && !seen.has(at) && chain.length < MAX_FOLDER_DEPTH; ) {
		seen.add(at);
		const folder = await prisma.cloudInventoryFolder.findUnique({ where: { id: at }, select: { parentId: true, visibility: true } });
		if (!folder) break;
		chain.push(folder);
		at = folder.parentId;
	}
	if (!isPubliclyReadable(item, chain)) throw new NotFoundError();
	return { id: item.id, folderId: null, name: item.name, slotData: migrateSlotTree(item.slotData as unknown as SlotTree), kind: item.kind, thumbnailAssetId: item.thumbnailAssetId, createdAt: item.createdAt.toISOString() };
}

export async function updateCloudItem(user: SessionUser | null, itemId: string, folderId: string | null, name: string, slotData: SlotTree, thumbnailAssetId?: unknown) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.cloudInventoryItem.findUnique({ where: { id: itemId } });
	if (!item) throw new NotFoundError();
	if (item.ownerId !== user.id) throw new ForbiddenError();
	if (item.kind === 'world') throw new BadRequestError('World revisions are immutable; save a new revision instead');
	return prisma.$transaction(async (tx) => {
		const scene = migrateSlotTree(slotData);
		const assetIds = await assertAssetsReady(tx, scene);
		const thumbnail = await resolveThumbnail(tx, thumbnailAssetId, item.thumbnailAssetId);
		await assertInventoryQuota(tx, user.id, sceneBytes(scene) - sceneBytes(item.slotData));
		const updated = await tx.cloudInventoryItem.update({ where: { id: itemId }, data: { folderId, name, slotData: scene as object, thumbnailAssetId: thumbnail } });
		await linkSceneAssets(tx, user, { kind: 'cloudItem', id: itemId }, withThumbnail(assetIds, thumbnail));
		return updated;
	});
}
