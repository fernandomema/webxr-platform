import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError } from '../errors';
import { validateWorldScene } from '$lib/worlds/package';
import { migrateSlotTree } from '$lib/assets/ref';
import { assertAssetsReady, assertInventoryQuota, linkSceneAssets } from './assets';
import type { SlotTree } from '$lib/ecs/types';
import type { SessionUser } from './worlds';

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
	kind: 'object' | 'world' = 'object',
	worldLineageId?: string
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
			await assertInventoryQuota(tx, user.id, sceneBytes(scene));
			const item = await tx.cloudInventoryItem.create({ data: {
				ownerId: user.id, folderId, name, slotData: scene as object,
				kind, worldLineageId: lineage, revisionNumber: (latest?.revisionNumber ?? 0) + 1
			} });
			await linkSceneAssets(tx, user, { kind: 'cloudItem', id: item.id }, assetIds);
			return item;
		});
	}
	return prisma.$transaction(async (tx) => {
		const scene = migrateSlotTree(slotData);
		const assetIds = await assertAssetsReady(tx, scene);
		await assertInventoryQuota(tx, user.id, sceneBytes(scene));
		const item = await tx.cloudInventoryItem.create({ data: { ownerId: user.id, folderId, name, slotData: scene as object, kind } });
		await linkSceneAssets(tx, user, { kind: 'cloudItem', id: item.id }, assetIds);
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

export async function updateCloudItem(user: SessionUser | null, itemId: string, folderId: string | null, name: string, slotData: SlotTree) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.cloudInventoryItem.findUnique({ where: { id: itemId } });
	if (!item) throw new NotFoundError();
	if (item.ownerId !== user.id) throw new ForbiddenError();
	if (item.kind === 'world') throw new BadRequestError('World revisions are immutable; save a new revision instead');
	return prisma.$transaction(async (tx) => {
		const scene = migrateSlotTree(slotData);
		const assetIds = await assertAssetsReady(tx, scene);
		await assertInventoryQuota(tx, user.id, sceneBytes(scene) - sceneBytes(item.slotData));
		const updated = await tx.cloudInventoryItem.update({ where: { id: itemId }, data: { folderId, name, slotData: scene as object } });
		await linkSceneAssets(tx, user, { kind: 'cloudItem', id: itemId }, assetIds);
		return updated;
	});
}
