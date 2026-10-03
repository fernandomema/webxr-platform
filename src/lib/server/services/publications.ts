import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../errors';
import { validateWorldScene } from '$lib/worlds/package';
import { collectAssetIds, migrateSlotTree } from '$lib/assets/ref';
import { assertAssetsReady, assetSummaries, linkSceneAssets, resolveThumbnail, withThumbnail } from './assets';
import type { AppInfoComponent, SlotTree } from '$lib/ecs/types';
import { findAppInfo } from '$lib/worlds/appManifest';
import type { WorldPackage } from '$lib/worlds/types';
import type { SessionUser } from './worlds';

function validateInput(name: unknown, scene: unknown): { name: string; scene: SlotTree } {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120) throw new Error('Invalid world name');
  validateWorldScene(scene);
  return { name: name.trim(), scene };
}

export async function listPublications() {
  return prisma.publishedWorld.findMany({
    select: { id: true, name: true, ownerId: true, latestRevision: true, thumbnailAssetId: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' }, take: 50
  });
}

export async function publishWorld(user: SessionUser | null, name: unknown, scene: unknown, thumbnailAssetId?: unknown) {
  if (!user) throw new UnauthorizedError();
  const input = validateInput(name, scene);
  const migrated = migrateSlotTree(input.scene);
  return prisma.$transaction(async (tx) => {
    // A published world must be self-contained: every model it uses has to be in the cloud.
    const assetIds = await assertAssetsReady(tx, migrated);
    const thumbnail = await resolveThumbnail(tx, thumbnailAssetId, null);
    const publication = await tx.publishedWorld.create({
      data: {
        ownerId: user.id,
        name: input.name,
        thumbnailAssetId: thumbnail,
        revisions: { create: { number: 1, sceneData: migrated as object } }
      },
      select: { id: true, name: true, latestRevision: true, revisions: { select: { id: true } } }
    });
    await linkSceneAssets(tx, user, { kind: 'publishedRevision', id: publication.revisions[0].id }, withThumbnail(assetIds, thumbnail));
    return { id: publication.id, name: publication.name, latestRevision: publication.latestRevision };
  });
}

export async function publishRevision(user: SessionUser | null, publicationId: string, scene: unknown, thumbnailAssetId?: unknown) {
  if (!user) throw new UnauthorizedError();
  validateWorldScene(scene);
  const migrated = migrateSlotTree(scene);
  return prisma.$transaction(async (tx) => {
    const publication = await tx.publishedWorld.findUnique({ where: { id: publicationId } });
    if (!publication) throw new NotFoundError();
    if (publication.ownerId !== user.id) throw new ForbiddenError();
    const assetIds = await assertAssetsReady(tx, migrated);
    // A revision without a preview of its own keeps the previous one: the picture may be a little out of date, never missing.
    const thumbnail = await resolveThumbnail(tx, thumbnailAssetId, publication.thumbnailAssetId);
    const number = publication.latestRevision + 1;
    const revision = await tx.publishedWorldRevision.create({
      data: { publicationId, number, sceneData: migrated as object }
    });
    await linkSceneAssets(tx, user, { kind: 'publishedRevision', id: revision.id }, withThumbnail(assetIds, thumbnail));
    await tx.publishedWorld.update({ where: { id: publicationId }, data: { latestRevision: number, thumbnailAssetId: thumbnail } });
    return { id: revision.id, number };
  });
}

export async function getPublishedWorld(publicationId: string, revisionId?: string): Promise<WorldPackage> {
  const publication = await prisma.publishedWorld.findUnique({ where: { id: publicationId } });
  if (!publication) throw new NotFoundError();
  const revision = revisionId
    ? await prisma.publishedWorldRevision.findFirst({ where: { id: revisionId, publicationId } })
    : await prisma.publishedWorldRevision.findUnique({ where: { publicationId_number: { publicationId, number: publication.latestRevision } } });
  if (!revision) throw new NotFoundError();
  const scene = revision.sceneData as unknown;
  validateWorldScene(scene);
  const migrated = migrateSlotTree(scene);
  return {
    formatVersion: 1,
    name: publication.name,
    scene: migrated,
    assets: await assetSummaries(prisma, [...collectAssetIds(migrated)]),
    defaultVisibility: 'private',
    source: { kind: 'published', worldId: publication.id, revisionId: revision.id }
  };
}

/** Confirms a publication (and, when given, that the revision belongs to it). Persistent storage trusts this, never the `source` a world package declares about itself. */
export async function resolvePublicationContext(publicationId: string, revisionId?: string) {
  const publication = await prisma.publishedWorld.findUnique({ where: { id: publicationId }, select: { id: true, latestRevision: true } });
  if (!publication) throw new NotFoundError();
  if (!revisionId) return { publicationId: publication.id, revisionId: null, revisionNumber: publication.latestRevision };
  const revision = await prisma.publishedWorldRevision.findFirst({ where: { id: revisionId, publicationId }, select: { id: true, number: true } });
  if (!revision) throw new NotFoundError();
  return { publicationId: publication.id, revisionId: revision.id, revisionNumber: revision.number };
}

export interface PublishedWorldApp {
  publicationId: string;
  worldName: string;
  /** Changes whenever a new revision is published, so manifests and icons can be cached against it. */
  revisionId: string;
  info: AppInfoComponent | null;
  /** The icon the author picked, if it is an asset. */
  iconAssetId: string | null;
  thumbnailAssetId: string | null;
}

/** What a published world needs to present itself as an installable app (its latest revision). */
export async function getPublishedWorldApp(publicationId: string): Promise<PublishedWorldApp> {
  const publication = await prisma.publishedWorld.findUnique({ where: { id: publicationId } });
  if (!publication) throw new NotFoundError();
  const revision = await prisma.publishedWorldRevision.findUnique({ where: { publicationId_number: { publicationId, number: publication.latestRevision } } });
  if (!revision) throw new NotFoundError();
  const scene = revision.sceneData as unknown;
  const info = Array.isArray(scene) ? findAppInfo(scene) : null;
  const icon = info?.icon;
  return {
    publicationId,
    worldName: publication.name,
    revisionId: revision.id,
    info,
    iconAssetId: icon?.kind === 'asset' ? icon.assetId : null,
    thumbnailAssetId: publication.thumbnailAssetId
  };
}
