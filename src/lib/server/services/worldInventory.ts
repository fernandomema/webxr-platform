import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError } from '../errors';
import { validateWorldScene } from '$lib/worlds/package';
import { migrateSlotTree } from '$lib/assets/ref';
import { linkSceneAssets, readyAssetIds } from './assets';
import type { SlotTree } from '$lib/ecs/types';
import type { SessionUser } from './worlds';

async function assertHost(user: SessionUser | null, worldId: string) {
	if (!user) throw new UnauthorizedError();
	const world = await prisma.world.findUnique({ where: { id: worldId } });
	if (!world) throw new NotFoundError();
	if (world.hostUserId !== user.id) throw new ForbiddenError();
}

/** Anyone can list (host + guests, per the v1 permission model); only the host can create/delete. */
export async function listWorldFolders(worldId: string, parentId: string | null) {
	return prisma.worldInventoryFolder.findMany({
		where: { worldId, parentId },
		orderBy: { name: 'asc' }
	});
}

export async function createWorldFolder(
	user: SessionUser | null,
	worldId: string,
	parentId: string | null,
	name: string
) {
	await assertHost(user, worldId);
	return prisma.worldInventoryFolder.create({ data: { worldId, parentId, name } });
}

export async function deleteWorldFolder(user: SessionUser | null, worldId: string, folderId: string) {
	await assertHost(user, worldId);
	await prisma.worldInventoryFolder.delete({ where: { id: folderId } });
}

export async function listWorldItems(worldId: string, folderId: string | null) {
	return prisma.worldInventoryItem.findMany({ where: { worldId, folderId }, orderBy: { createdAt: 'desc' } });
}

export async function saveWorldItem(
	user: SessionUser | null,
	worldId: string,
	folderId: string | null,
	name: string,
	slotData: SlotTree,
	kind: 'object' | 'world' = 'object',
	worldLineageId?: string
) {
	await assertHost(user, worldId);
	if (kind === 'world') {
		try { validateWorldScene(slotData); } catch (err) { throw new BadRequestError(err instanceof Error ? err.message : 'Invalid world scene'); }
		const lineage = worldLineageId ?? randomUUID();
		if (!/^[a-zA-Z0-9_-]{1,64}$/.test(lineage)) throw new BadRequestError('Invalid world lineage');
		return prisma.$transaction(async (tx) => {
			const latest = await tx.worldInventoryItem.findFirst({
				where: { worldId, worldLineageId: lineage, kind: 'world' },
				orderBy: { revisionNumber: 'desc' }, select: { revisionNumber: true }
			});
			const scene = migrateSlotTree(slotData);
			const item = await tx.worldInventoryItem.create({ data: {
				worldId, folderId, name, slotData: scene as object,
				kind, worldLineageId: lineage, revisionNumber: (latest?.revisionNumber ?? 0) + 1
			} });
			// Best effort: models that only exist on the host's device reach guests peer to peer.
			await linkSceneAssets(tx, user!, { kind: 'worldInventoryItem', id: item.id }, await readyAssetIds(tx, scene));
			return item;
		});
	}
	return prisma.$transaction(async (tx) => {
		const scene = migrateSlotTree(slotData);
		const item = await tx.worldInventoryItem.create({ data: { worldId, folderId, name, slotData: scene as object, kind } });
		await linkSceneAssets(tx, user!, { kind: 'worldInventoryItem', id: item.id }, await readyAssetIds(tx, scene));
		return item;
	});
}

export async function deleteWorldItem(user: SessionUser | null, worldId: string, itemId: string) {
	await assertHost(user, worldId);
	await prisma.worldInventoryItem.delete({ where: { id: itemId } });
}

export async function updateWorldItem(user: SessionUser | null, worldId: string, itemId: string, folderId: string | null, name: string, slotData: SlotTree) {
	await assertHost(user, worldId);
	const item = await prisma.worldInventoryItem.findUnique({ where: { id: itemId } });
	if (!item || item.worldId !== worldId) throw new NotFoundError();
	if (item.kind === 'world') throw new BadRequestError('World revisions are immutable; save a new revision instead');
	return prisma.$transaction(async (tx) => {
		const scene = migrateSlotTree(slotData);
		const updated = await tx.worldInventoryItem.update({ where: { id: itemId }, data: { folderId, name, slotData: scene as object } });
		await linkSceneAssets(tx, user!, { kind: 'worldInventoryItem', id: itemId }, await readyAssetIds(tx, scene));
		return updated;
	});
}
