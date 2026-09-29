import { prisma } from '../db';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors';
import { validateWorldScene } from '$lib/worlds/package';
import { migrateSlotTree, collectAssetIds } from '$lib/assets/ref';
import { assertAssetsReady, assetSummaries, linkSceneAssets } from './assets';
import type { SlotTree } from '$lib/ecs/types';
import type { SessionUser } from './worlds';

const MAX_DESCRIPTION = 2000;
function validateItem(name: unknown, description: unknown, scene: unknown) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new BadRequestError('Invalid item name');
  if (description !== undefined && (typeof description !== 'string' || description.length > MAX_DESCRIPTION)) throw new BadRequestError('Invalid item description');
  try { validateWorldScene(scene); } catch (err) { throw new BadRequestError(err instanceof Error ? err.message : 'Invalid object'); }
  return { name: name.trim(), description: (description as string | undefined)?.trim() ?? '', scene: migrateSlotTree(scene as SlotTree) };
}

function hasCodeBlock(scene: unknown): boolean {
  return Array.isArray(scene) && scene.some((slot) => Array.isArray(slot?.components) && slot.components.some((component: { type?: string }) => component?.type === 'codeBlock'));
}

function summary(item: { id: string; ownerId: string; name: string; description: string; thumbnailUrl: string | null; latestRevision: number; status: string; createdAt: Date; updatedAt: Date; revisions?: Array<{ slotData: unknown }> }) {
  const latest = item.revisions?.[0]?.slotData;
  return { id: item.id, ownerId: item.ownerId, name: item.name, description: item.description, thumbnailUrl: item.thumbnailUrl, latestRevision: item.latestRevision, status: item.status, createdAt: item.createdAt, updatedAt: item.updatedAt, containsCode: hasCodeBlock(latest) };
}

export async function listMarketplaceItems() {
  const items = await prisma.marketplaceItem.findMany({ where: { status: 'published' }, orderBy: { updatedAt: 'desc' }, take: 100 });
  // Fetch the current revisions explicitly; relation filters cannot reference the parent scalar portably.
  const result = await Promise.all(items.map(async (item) => {
    const revision = await prisma.marketplaceItemRevision.findUnique({ where: { marketplaceItemId_number: { marketplaceItemId: item.id, number: item.latestRevision } }, select: { slotData: true } });
    return summary({ ...item, revisions: revision ? [revision] : [] });
  }));
  return result;
}

export async function getMarketplaceItem(id: string, user: SessionUser | null) {
  const item = await prisma.marketplaceItem.findUnique({ where: { id } });
  if (!item || (item.status !== 'published' && item.ownerId !== user?.id)) throw new NotFoundError();
  const revision = await prisma.marketplaceItemRevision.findUnique({ where: { marketplaceItemId_number: { marketplaceItemId: id, number: item.latestRevision } } });
  if (!revision) throw new NotFoundError();
  return { ...summary({ ...item, revisions: [revision] }), slotData: revision.slotData, assets: await assetSummaries(prisma, [...collectAssetIds(revision.slotData as unknown as SlotTree)]) };
}

export async function createMarketplaceItem(user: SessionUser | null, input: { name: unknown; description?: unknown; thumbnailUrl?: unknown; slotData: unknown; source?: { adapterId: string; itemId: string; worldId?: string | null } }) {
  if (!user) throw new UnauthorizedError();
  if (input.source && !['local', 'cloud', 'world'].includes(input.source.adapterId)) throw new BadRequestError('Invalid inventory source');
  let scene = input.slotData;
  let sourceRecord: { kind: 'cloud' | 'world'; id: string } | null = null;
  if (input.source?.adapterId === 'cloud') {
    const item = await prisma.cloudInventoryItem.findUnique({ where: { id: input.source.itemId } });
    if (!item) throw new NotFoundError();
    if (item.ownerId !== user.id) throw new ForbiddenError();
    if (item.kind !== 'object') throw new BadRequestError('Only objects can be published');
    sourceRecord = { kind: 'cloud', id: item.id };
  } else if (input.source?.adapterId === 'world') {
    const item = await prisma.worldInventoryItem.findUnique({ where: { id: input.source.itemId }, include: { world: true } });
    if (!item || item.worldId !== input.source.worldId) throw new NotFoundError();
    if (item.world.hostUserId !== user.id) throw new ForbiddenError();
    if (item.kind !== 'object') throw new BadRequestError('Only objects can be published');
    sourceRecord = { kind: 'world', id: item.id };
  }
  const data = validateItem(input.name, input.description, scene);
  const thumbnailUrl = input.thumbnailUrl == null ? null : typeof input.thumbnailUrl === 'string' && input.thumbnailUrl.length <= 2048 ? input.thumbnailUrl : (() => { throw new BadRequestError('Invalid thumbnail URL'); })();
  return prisma.$transaction(async (tx) => {
    const assetIds = await assertAssetsReady(tx, data.scene);
    const item = await tx.marketplaceItem.create({ data: { ownerId: user.id, name: data.name, description: data.description, thumbnailUrl, revisions: { create: { number: 1, slotData: data.scene as object } } }, include: { revisions: true } });
    await linkSceneAssets(tx, user, { kind: 'marketplaceRevision', id: item.revisions[0].id }, assetIds);
    if (sourceRecord?.kind === 'cloud') await tx.cloudInventoryItem.update({ where: { id: sourceRecord.id }, data: { marketplaceItemId: item.id } });
    if (sourceRecord?.kind === 'world') await tx.worldInventoryItem.update({ where: { id: sourceRecord.id }, data: { marketplaceItemId: item.id } });
    return summary({ ...item, revisions: item.revisions });
  });
}

export async function updateMarketplaceItem(user: SessionUser | null, id: string, input: { name?: unknown; description?: unknown; thumbnailUrl?: unknown; slotData?: unknown; status?: unknown }) {
  if (!user) throw new UnauthorizedError();
  const item = await prisma.marketplaceItem.findUnique({ where: { id } });
  if (!item) throw new NotFoundError();
  if (item.ownerId !== user.id) throw new ForbiddenError();
  if (input.status !== undefined && input.status !== 'published' && input.status !== 'hidden') throw new BadRequestError('Invalid publication status');
  let data: ReturnType<typeof validateItem> | null = null;
  if (input.slotData !== undefined) data = validateItem(input.name ?? item.name, input.description ?? item.description, input.slotData);
  if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120)) throw new BadRequestError('Invalid item name');
  if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION)) throw new BadRequestError('Invalid item description');
  const name = input.name === undefined ? item.name : (input.name as string).trim();
  const description = input.description === undefined ? item.description : (input.description as string).trim();
  const thumbnailUrl = input.thumbnailUrl === undefined ? item.thumbnailUrl : input.thumbnailUrl === null ? null : typeof input.thumbnailUrl === 'string' && input.thumbnailUrl.length <= 2048 ? input.thumbnailUrl : (() => { throw new BadRequestError('Invalid thumbnail URL'); })();
  return prisma.$transaction(async (tx) => {
    let latestRevision = item.latestRevision;
    if (data) {
      const assetIds = await assertAssetsReady(tx, data.scene);
      const number = item.latestRevision + 1;
      const revision = await tx.marketplaceItemRevision.create({ data: { marketplaceItemId: id, number, slotData: data.scene as object } });
      await linkSceneAssets(tx, user, { kind: 'marketplaceRevision', id: revision.id }, assetIds);
      latestRevision = number;
    }
    const updated = await tx.marketplaceItem.update({ where: { id }, data: { name, description, thumbnailUrl, latestRevision, ...(input.status ? { status: input.status } : {}) } });
    return summary({ ...updated, revisions: data ? [{ slotData: data.scene }] : [] });
  });
}

export async function purchaseMarketplaceItem(user: SessionUser | null, id: string) {
  if (!user) throw new UnauthorizedError();
  const item = await prisma.marketplaceItem.findUnique({ where: { id } });
  if (!item || item.status !== 'published') throw new NotFoundError();
  await prisma.marketplacePurchase.upsert({ where: { userId_marketplaceItemId: { userId: user.id, marketplaceItemId: id } }, create: { userId: user.id, marketplaceItemId: id }, update: {} });
  return { acquired: true, marketplaceItemId: id };
}

export async function listPurchasedItems(user: SessionUser | null) {
  if (!user) throw new UnauthorizedError();
  const purchases = await prisma.marketplacePurchase.findMany({ where: { userId: user.id }, include: { marketplaceItem: true }, orderBy: { createdAt: 'desc' } });
  return Promise.all(purchases.map(async ({ marketplaceItem: item, createdAt }) => {
    const revision = await prisma.marketplaceItemRevision.findUnique({ where: { marketplaceItemId_number: { marketplaceItemId: item.id, number: item.latestRevision } } });
    if (!revision) return null;
    return { id: item.id, folderId: null, name: item.name, slotData: revision.slotData, kind: 'object' as const, marketplaceItemId: item.id, thumbnailUrl: item.thumbnailUrl, createdAt: createdAt.toISOString(), revisionNumber: item.latestRevision };
  })).then((items) => items.filter(Boolean));
}
