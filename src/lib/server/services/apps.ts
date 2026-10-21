import { prisma } from '../db';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../errors';
import { collectProducts, type ShopProduct } from '@kithin/engine/credits/catalog';
import { parseAppName, parseAppOrigins, parseAppProducts, shopScene } from '../appInput';
import type { SessionUser } from './worlds';

/**
 * An app is the identity of a game built on the engine whose levels ship with the game, not with Kithin: the game can have hundreds
 * of them, and they share one set of saved data, leaderboards and shop. It is stored as a publication of kind 'app' (see the
 * schema), so everything that works for a published world's id works for an app's id: the game gives it as its `appId`.
 */
const MAX_APPS_PER_USER = 20;

export interface AppSummary {
	id: string;
	name: string;
	origins: string[];
	products: ShopProduct[];
	createdAt: Date;
}

async function summarize(app: { id: string; name: string; origins: string[]; createdAt: Date; revisions: Array<{ sceneData: unknown }> }): Promise<AppSummary> {
	let products: ShopProduct[] = [];
	try { products = [...collectProducts(app.revisions[0]?.sceneData).values()]; } catch { products = []; }
	return { id: app.id, name: app.name, origins: app.origins, products, createdAt: app.createdAt };
}

const select = (revision: number) => ({ id: true, name: true, origins: true, createdAt: true, revisions: { where: { number: revision }, select: { sceneData: true } } }) as const;

async function ownedApp(user: SessionUser, appId: string) {
	const app = await prisma.publishedWorld.findUnique({ where: { id: appId }, select: { id: true, kind: true, ownerId: true, latestRevision: true } });
	if (!app || app.kind !== 'app') throw new NotFoundError();
	if (app.ownerId !== user.id) throw new ForbiddenError();
	return app;
}

export async function listApps(user: SessionUser | null): Promise<AppSummary[]> {
	if (!user) throw new UnauthorizedError();
	const apps = await prisma.publishedWorld.findMany({ where: { ownerId: user.id, kind: 'app' }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, origins: true, createdAt: true, latestRevision: true } });
	// Each app's shop is in its latest revision, which differs per app.
	const revisions = apps.length === 0 ? [] : await prisma.publishedWorldRevision.findMany({ where: { OR: apps.map((app) => ({ publicationId: app.id, number: app.latestRevision })) }, select: { publicationId: true, sceneData: true } });
	return Promise.all(apps.map((app) => summarize({ ...app, revisions: revisions.filter((revision) => revision.publicationId === app.id) })));
}

export async function createApp(user: SessionUser | null, body: unknown): Promise<AppSummary> {
	if (!user) throw new UnauthorizedError();
	const { name, origins, products } = (body ?? {}) as { name?: unknown; origins?: unknown; products?: unknown };
	if ((await prisma.publishedWorld.count({ where: { ownerId: user.id, kind: 'app' } })) >= MAX_APPS_PER_USER) throw new BadRequestError(`You can have up to ${MAX_APPS_PER_USER} apps`);
	const shop = parseAppProducts(products);
	const app = await prisma.publishedWorld.create({
		data: { ownerId: user.id, kind: 'app', name: parseAppName(name), origins: parseAppOrigins(origins ?? []), revisions: { create: { number: 1, sceneData: shopScene(shop) as object } } },
		select: select(1)
	});
	return summarize(app);
}

export async function updateApp(user: SessionUser | null, appId: string, body: unknown): Promise<AppSummary> {
	if (!user) throw new UnauthorizedError();
	const app = await ownedApp(user, appId);
	const { name, origins, products } = (body ?? {}) as { name?: unknown; origins?: unknown; products?: unknown };
	const shop = products === undefined ? null : parseAppProducts(products);
	const data = { ...(name === undefined ? {} : { name: parseAppName(name) }), ...(origins === undefined ? {} : { origins: parseAppOrigins(origins) }) };
	// A change to the shop is a new revision: a purchase already offered to a player is settled against the one it was offered from.
	const number = shop ? app.latestRevision + 1 : app.latestRevision;
	await prisma.$transaction(async (tx) => {
		if (shop) await tx.publishedWorldRevision.create({ data: { publicationId: appId, number, sceneData: shopScene(shop) as object } });
		await tx.publishedWorld.update({ where: { id: appId }, data: { ...data, ...(shop ? { latestRevision: number } : {}) } });
	});
	return summarize(await prisma.publishedWorld.findUniqueOrThrow({ where: { id: appId }, select: select(number) }));
}

export async function deleteApp(user: SessionUser | null, appId: string): Promise<void> {
	if (!user) throw new UnauthorizedError();
	await ownedApp(user, appId);
	await prisma.publishedWorld.delete({ where: { id: appId } });
}
