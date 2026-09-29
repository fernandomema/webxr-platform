import { prisma } from '../db';
import { UnauthorizedError, ForbiddenError, NotFoundError } from '../errors';
import { validateWorldScene } from '$lib/worlds/package';
import type { SlotTree } from '$lib/ecs/types';
import type { WorldPackage } from '$lib/worlds/types';
import type { SessionUser } from './worlds';

function validateInput(name: unknown, scene: unknown): { name: string; scene: SlotTree } {
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 120) throw new Error('Invalid world name');
  validateWorldScene(scene);
  return { name: name.trim(), scene };
}

export async function listPublications() {
  return prisma.publishedWorld.findMany({
    select: { id: true, name: true, ownerId: true, latestRevision: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' }, take: 50
  });
}

export async function publishWorld(user: SessionUser | null, name: unknown, scene: unknown) {
  if (!user) throw new UnauthorizedError();
  const input = validateInput(name, scene);
  return prisma.publishedWorld.create({
    data: {
      ownerId: user.id,
      name: input.name,
      revisions: { create: { number: 1, sceneData: input.scene as object } }
    },
    select: { id: true, name: true, latestRevision: true }
  });
}

export async function publishRevision(user: SessionUser | null, publicationId: string, scene: unknown) {
  if (!user) throw new UnauthorizedError();
  validateWorldScene(scene);
  return prisma.$transaction(async (tx) => {
    const publication = await tx.publishedWorld.findUnique({ where: { id: publicationId } });
    if (!publication) throw new NotFoundError();
    if (publication.ownerId !== user.id) throw new ForbiddenError();
    const number = publication.latestRevision + 1;
    const revision = await tx.publishedWorldRevision.create({
      data: { publicationId, number, sceneData: scene as object }
    });
    await tx.publishedWorld.update({ where: { id: publicationId }, data: { latestRevision: number } });
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
  return {
    formatVersion: 1,
    name: publication.name,
    scene,
    defaultVisibility: 'private',
    source: { kind: 'published', worldId: publication.id, revisionId: revision.id }
  };
}
