import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../errors';
import type { SlotTree } from '$lib/ecs/types';
import type { SessionUser } from './worlds';

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
	slotData: SlotTree
) {
	if (!user) throw new UnauthorizedError();
	return prisma.cloudInventoryItem.create({
		data: { ownerId: user.id, folderId, name, slotData: slotData as object }
	});
}

export async function deleteCloudItem(user: SessionUser | null, itemId: string) {
	if (!user) throw new UnauthorizedError();
	const item = await prisma.cloudInventoryItem.findUnique({ where: { id: itemId } });
	if (!item) throw new NotFoundError();
	if (item.ownerId !== user.id) throw new ForbiddenError();
	await prisma.cloudInventoryItem.delete({ where: { id: itemId } });
}
