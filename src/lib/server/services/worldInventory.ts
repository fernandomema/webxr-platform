import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../errors';
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
	slotData: SlotTree
) {
	await assertHost(user, worldId);
	return prisma.worldInventoryItem.create({
		data: { worldId, folderId, name, slotData: slotData as object }
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
	return prisma.worldInventoryItem.update({
		where: { id: itemId },
		data: { folderId, name, slotData: slotData as object }
	});
}
