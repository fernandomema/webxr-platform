import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { canReleaseOwnership, wouldExceedQuota } from '$lib/assets/accounting';
import { getAssetKind } from '$lib/assets/kinds';
import { summarizeManifest, validateManifest, type AssetManifest, type AssetSummary } from '$lib/assets/manifest';
import { collectAssetIds, isAssetId, type AssetId } from '$lib/assets/ref';
import { prisma } from '../db';
import {
	assetStorageConfigured,
	deleteObject,
	getObjectStream,
	hashObject,
	objectSize,
	presignDownload,
	presignUpload,
	putObject,
	readHead,
	storageKeyFor,
	transferMode
} from '../assetStorage';
import {
	BadRequestError,
	ForbiddenError,
	MissingAssetsError,
	NotFoundError,
	PayloadTooLargeError,
	QuotaExceededError,
	UnauthorizedError,
	UnsupportedMediaError
} from '../errors';
import type { SessionUser } from './worlds';

/** Either the shared client or a transaction, so the same helpers work inside both. */
type Db = Pick<
	typeof prisma,
	'asset' | 'assetOwner' | 'cloudItemAsset' | 'worldInventoryItemAsset' | 'publishedRevisionAsset' | 'marketplaceRevisionAsset' | 'worldAsset' | '$queryRaw'
>;

export type AssetHolder =
	| { kind: 'cloudItem'; id: string }
	| { kind: 'worldInventoryItem'; id: string }
	| { kind: 'publishedRevision'; id: string }
	| { kind: 'marketplaceRevision'; id: string }
	| { kind: 'world'; id: string };

/** Extension of the stored object: the first one the kind lists for the format. */
function extensionOf(manifest: AssetManifest): string {
	const format = getAssetKind(manifest.type)?.formats.find((entry) => entry.format === manifest.format);
	return (format?.extensions[0] ?? '').replace(/^\./, '');
}

export const userQuotaBytes = () => Number(env.ASSET_USER_QUOTA_BYTES ?? 524_288_000);

function requireStorage(): void {
	if (!assetStorageConfigured()) throw new BadRequestError('Asset storage is not configured on this server.');
}

// --- URLs -------------------------------------------------------------------

/** Where the browser sends the bytes: straight to S3 when it can, otherwise through this server. */
async function uploadTarget(id: AssetId, storageKey: string, mimeType: string): Promise<{ method: 'PUT'; url: string; headers: Record<string, string> }> {
	if (transferMode() === 'proxy') return { method: 'PUT', url: `/api/assets/blob/${encodeURIComponent(id)}`, headers: { 'content-type': mimeType } };
	const { url, headers } = await presignUpload(storageKey, mimeType);
	return { method: 'PUT', url, headers };
}

async function downloadTarget(id: AssetId, storageKey: string): Promise<{ url: string; expiresAt: number }> {
	if (transferMode() === 'proxy') return { url: `/api/assets/blob/${encodeURIComponent(id)}`, expiresAt: Date.now() + 15 * 60_000 };
	return presignDownload(storageKey);
}

// --- ownership ----------------------------------------------------------------

async function assetBytes(db: Db, userId: string): Promise<number> {
	const owned = await db.assetOwner.findMany({ where: { ownerId: userId }, select: { asset: { select: { byteSize: true } } } });
	return owned.reduce((sum, row) => sum + row.asset.byteSize, 0);
}

/** Size of the scene JSON (the hierarchy tree) of everything in the user's cloud inventory. */
export async function inventoryJsonBytes(db: Db, userId: string): Promise<number> {
	const rows = await db.$queryRaw<Array<{ bytes: bigint }>>`SELECT COALESCE(SUM(octet_length("slotData"::text)), 0)::bigint AS bytes FROM "cloudInventoryItem" WHERE "ownerId" = ${userId}`;
	return Number(rows[0]?.bytes ?? 0);
}

async function usedBytes(db: Db, userId: string): Promise<number> {
	return (await assetBytes(db, userId)) + (await inventoryJsonBytes(db, userId));
}

/** Refuses a save that would push the user over their storage quota. `adding` is the extra bytes of scene JSON. */
export async function assertInventoryQuota(db: Db, userId: string, adding: number): Promise<void> {
	if (adding <= 0) return;
	if (wouldExceedQuota({ used: await usedBytes(db, userId), adding, alreadyOwner: false, quota: userQuotaBytes() })) {
		throw new QuotaExceededError('Your storage is full. Remove models or saved items you no longer use.');
	}
}

/**
 * Makes `userId` an owner of the asset. Every owner is charged the model's full
 * size (there is still only one stored copy), which is checked against their quota.
 */
async function grantOwnership(db: Db, userId: string, asset: { id: string; byteSize: number }, name: string, source: 'upload' | 'reupload' | 'clone'): Promise<void> {
	const existing = await db.assetOwner.findUnique({ where: { assetId_ownerId: { assetId: asset.id, ownerId: userId } } });
	if (existing) return;
	const used = await usedBytes(db, userId);
	if (wouldExceedQuota({ used, adding: asset.byteSize, alreadyOwner: false, quota: userQuotaBytes() })) {
		throw new QuotaExceededError('Your model storage is full. Remove models you no longer use.');
	}
	await db.assetOwner.create({ data: { assetId: asset.id, ownerId: userId, name: name.slice(0, 120), source } });
	await db.asset.updateMany({ where: { id: asset.id, orphanedAt: { not: null } }, data: { orphanedAt: null } });
}

async function referenceCount(db: Db, assetId: string): Promise<number> {
	const [items, worldItems, revisions, marketplaceRevisions, worlds] = await Promise.all([
		db.cloudItemAsset.count({ where: { assetId } }),
		db.worldInventoryItemAsset.count({ where: { assetId } }),
		db.publishedRevisionAsset.count({ where: { assetId } }),
		db.marketplaceRevisionAsset.count({ where: { assetId } }),
		db.worldAsset.count({ where: { assetId } })
	]);
	return items + worldItems + revisions + marketplaceRevisions + worlds;
}

/** Starts the grace period for an asset nobody owns or uses (the cleanup script is the final judge). */
export async function markOrphanIfUnused(db: Db, assetId: string): Promise<void> {
	const [owners, references] = await Promise.all([db.assetOwner.count({ where: { assetId } }), referenceCount(db, assetId)]);
	if (owners === 0 && references === 0) await db.asset.updateMany({ where: { id: assetId, orphanedAt: null }, data: { orphanedAt: new Date() } });
}

// --- upload -------------------------------------------------------------------

export type UploadRequestResult =
	| { exists: true }
	| { exists: false; upload: { method: 'PUT'; url: string; headers: Record<string, string> } };

/**
 * Step 1 of an upload. If this exact model is already stored — by anyone —
 * nothing is uploaded: the caller just becomes another owner. Otherwise the
 * caller gets a place to send the bytes.
 */
export async function requestUpload(user: SessionUser | null, manifestInput: unknown): Promise<UploadRequestResult> {
	if (!user) throw new UnauthorizedError();
	requireStorage();
	let manifest: AssetManifest;
	try {
		manifest = validateManifest(manifestInput);
	} catch (error) {
		throw new BadRequestError(error instanceof Error ? error.message : 'Invalid asset');
	}
	const storageKey = storageKeyFor(manifest.assetId, extensionOf(manifest));
	const readyAlready = await prisma.$transaction(async (tx) => {
		const existing = await tx.asset.findUnique({ where: { id: manifest.assetId } });
		if (existing?.status === 'ready') {
			await grantOwnership(tx, user.id, existing, manifest.name, 'reupload');
			return true;
		}
		if (existing && existing.byteSize !== manifest.byteSize) throw new BadRequestError('This model does not match the upload already in progress.');
		if (!existing) {
			await tx.asset.create({
				data: {
					id: manifest.assetId,
					byteSize: manifest.byteSize,
					mimeType: manifest.mimeType,
					format: manifest.format,
					manifest: manifest as unknown as object,
					storageKey,
					firstUploadedById: user.id
				}
			});
		}
		await grantOwnership(tx, user.id, { id: manifest.assetId, byteSize: manifest.byteSize }, manifest.name, 'upload');
		return false;
	});
	if (readyAlready) return { exists: true };
	return { exists: false, upload: await uploadTarget(manifest.assetId, storageKey, manifest.mimeType) };
}

/** Step 2: checks that what arrived is the file that was announced, then marks the model ready for everyone. */
export async function completeUpload(user: SessionUser | null, assetId: string): Promise<void> {
	if (!user) throw new UnauthorizedError();
	requireStorage();
	if (!isAssetId(assetId)) throw new BadRequestError('Invalid asset id');
	const asset = await prisma.asset.findUnique({ where: { id: assetId } });
	if (!asset) throw new NotFoundError();
	const owner = await prisma.assetOwner.findUnique({ where: { assetId_ownerId: { assetId, ownerId: user.id } } });
	if (!owner) throw new ForbiddenError();
	if (asset.status === 'ready') return;

	const size = await objectSize(asset.storageKey);
	if (size === null) throw new BadRequestError('The upload has not arrived yet.');
	if (size !== asset.byteSize) {
		await deleteObject(asset.storageKey);
		throw new BadRequestError('The uploaded file does not match its announced size.');
	}
	// The announced kind and format are claims too: the file's own first bytes must agree.
	const kind = getAssetKind((asset.manifest as unknown as AssetManifest).type);
	const head = kind ? await readHead(asset.storageKey, kind.headBytes) : new Uint8Array();
	if (!kind || kind.sniff(head) !== asset.format) {
		await deleteObject(asset.storageKey);
		throw new UnsupportedMediaError(`The uploaded file is not a valid ${asset.format} file.`);
	}
	// The announced hash is a claim: check it against what was actually stored.
	if ((await hashObject(asset.storageKey)) !== assetId.slice('sha256:'.length)) {
		await deleteObject(asset.storageKey);
		throw new BadRequestError('The uploaded file does not match its hash.');
	}
	await prisma.asset.update({ where: { id: assetId }, data: { status: 'ready', readyAt: new Date() } });
}

/** Proxy mode only: the browser sent the bytes here instead of straight to S3. */
export async function receiveProxyUpload(user: SessionUser | null, assetId: string, bytes: Uint8Array): Promise<void> {
	if (!user) throw new UnauthorizedError();
	requireStorage();
	if (!isAssetId(assetId)) throw new BadRequestError('Invalid asset id');
	const asset = await prisma.asset.findUnique({ where: { id: assetId } });
	if (!asset) throw new NotFoundError();
	if (!(await prisma.assetOwner.findUnique({ where: { assetId_ownerId: { assetId, ownerId: user.id } } }))) throw new ForbiddenError();
	if (asset.status === 'ready') return;
	if (bytes.byteLength !== asset.byteSize) throw new BadRequestError('The uploaded file does not match its announced size.');
	if (bytes.byteLength > Number(env.ASSET_MAX_BYTES ?? 26_214_400)) throw new PayloadTooLargeError('The asset is too large.');
	if (createHash('sha256').update(bytes).digest('hex') !== assetId.slice('sha256:'.length)) throw new BadRequestError('The uploaded file does not match its hash.');
	await putObject(asset.storageKey, bytes, asset.mimeType);
}

// --- download -----------------------------------------------------------------

/**
 * A model is readable by its owners, and by anyone once a published world or a
 * hosted world uses it (they need it to play that world). The hash is the
 * capability for everything else: listing and ownership are what stay private.
 */
async function readableIds(user: SessionUser | null, ids: string[]): Promise<Set<string>> {
	const readable = new Set<string>();
	if (user) {
		for (const row of await prisma.assetOwner.findMany({ where: { ownerId: user.id, assetId: { in: ids } }, select: { assetId: true } })) readable.add(row.assetId);
	}
	const remaining = ids.filter((id) => !readable.has(id));
	if (remaining.length) {
		const [published, hosted, marketplace] = await Promise.all([
			prisma.publishedRevisionAsset.findMany({ where: { assetId: { in: remaining } }, select: { assetId: true }, distinct: ['assetId'] }),
			prisma.worldAsset.findMany({ where: { assetId: { in: remaining } }, select: { assetId: true }, distinct: ['assetId'] }),
			prisma.marketplaceRevisionAsset.findMany({ where: { assetId: { in: remaining }, revision: { marketplaceItem: { OR: [{ status: 'published' }, ...(user ? [{ purchases: { some: { userId: user.id } } }] : [])] } } }, select: { assetId: true }, distinct: ['assetId'] })
		]);
		for (const row of [...published, ...hosted, ...marketplace]) readable.add(row.assetId);
	}
	return readable;
}

export interface ResolvedAsset {
	url: string;
	expiresAt: number;
	manifest: AssetManifest;
}

export async function resolveAssets(user: SessionUser | null, idsInput: unknown): Promise<Record<string, ResolvedAsset>> {
	requireStorage();
	if (!Array.isArray(idsInput)) throw new BadRequestError('ids must be a list');
	const ids = [...new Set(idsInput.filter(isAssetId))].slice(0, 64);
	if (ids.length === 0) return {};
	const [assets, readable] = await Promise.all([prisma.asset.findMany({ where: { id: { in: ids }, status: 'ready' } }), readableIds(user, ids)]);
	const result: Record<string, ResolvedAsset> = {};
	for (const asset of assets) {
		if (!readable.has(asset.id)) continue;
		result[asset.id] = { ...(await downloadTarget(asset.id as AssetId, asset.storageKey)), manifest: asset.manifest as unknown as AssetManifest };
	}
	return result;
}

/** Proxy mode only: streams an asset this user is allowed to read. */
export async function openAssetForReading(user: SessionUser | null, assetId: string): Promise<{ stream: ReadableStream; size: number | undefined; mimeType: string }> {
	requireStorage();
	if (!isAssetId(assetId)) throw new BadRequestError('Invalid asset id');
	const asset = await prisma.asset.findUnique({ where: { id: assetId } });
	if (!asset || asset.status !== 'ready') throw new NotFoundError();
	if (!(await readableIds(user, [assetId])).has(assetId)) throw new NotFoundError();
	const object = await getObjectStream(asset.storageKey);
	if (!object) throw new NotFoundError();
	return { ...object, mimeType: asset.mimeType };
}

// --- my models ----------------------------------------------------------------

export interface MyAsset {
	assetId: string;
	name: string;
	byteSize: number;
	source: string;
	ownedSince: Date;
	manifest: AssetManifest;
	usedIn: { items: number; worlds: number; publications: number };
}

/** Counts of the things this user owns that still use the asset. */
async function referencesOwnedBy(db: Db & Pick<typeof prisma, 'cloudInventoryItem'>, userId: string, assetId: string) {
	const [items, worldItems, revisions, marketplaceRevisions, worlds] = await Promise.all([
		db.cloudItemAsset.count({ where: { assetId, item: { ownerId: userId } } }),
		db.worldInventoryItemAsset.count({ where: { assetId, item: { world: { hostUserId: userId } } } }),
		db.publishedRevisionAsset.count({ where: { assetId, revision: { publication: { ownerId: userId } } } }),
		db.marketplaceRevisionAsset.count({ where: { assetId, revision: { marketplaceItem: { ownerId: userId } } } }),
		db.worldAsset.count({ where: { assetId, world: { hostUserId: userId } } })
	]);
	return { items: items + worldItems, worlds, publications: revisions + marketplaceRevisions };
}

export async function listMyAssets(user: SessionUser | null): Promise<MyAsset[]> {
	if (!user) throw new UnauthorizedError();
	const owned = await prisma.assetOwner.findMany({ where: { ownerId: user.id }, include: { asset: true }, orderBy: { createdAt: 'desc' } });
	return Promise.all(
		owned.map(async (row) => ({
			assetId: row.assetId,
			name: row.name,
			byteSize: row.asset.byteSize,
			source: row.source,
			ownedSince: row.createdAt,
			manifest: row.asset.manifest as unknown as AssetManifest,
			usedIn: await referencesOwnedBy(prisma, user.id, row.assetId)
		}))
	);
}

export async function assetUsage(user: SessionUser | null): Promise<{ bytes: number; assetBytes: number; inventoryBytes: number; count: number; quota: number }> {
	if (!user) throw new UnauthorizedError();
	const [models, inventoryBytes, count] = await Promise.all([
		assetBytes(prisma, user.id),
		inventoryJsonBytes(prisma, user.id),
		prisma.assetOwner.count({ where: { ownerId: user.id } })
	]);
	return { bytes: models + inventoryBytes, assetBytes: models, inventoryBytes, count, quota: userQuotaBytes() };
}

/**
 * Lets go of the caller's ownership. The file itself is only deleted later, by
 * the cleanup, and only when nobody else owns it and nothing references it.
 */
export async function releaseOwnership(user: SessionUser | null, assetId: string): Promise<void> {
	if (!user) throw new UnauthorizedError();
	if (!isAssetId(assetId)) throw new BadRequestError('Invalid asset id');
	await prisma.$transaction(async (tx) => {
		const owner = await tx.assetOwner.findUnique({ where: { assetId_ownerId: { assetId, ownerId: user.id } } });
		if (!owner) throw new NotFoundError();
		const used = await referencesOwnedBy(tx, user.id, assetId);
		if (!canReleaseOwnership(used.items + used.worlds + used.publications)) {
			throw new BadRequestError('Some of your objects and worlds still use this model.');
		}
		await tx.assetOwner.delete({ where: { assetId_ownerId: { assetId, ownerId: user.id } } });
		await markOrphanIfUnused(tx, assetId);
	});
}

// --- scenes -------------------------------------------------------------------

/** The models a scene needs, checked to exist and be fully uploaded. Throws `MissingAssetsError` listing the rest. */
export async function assertAssetsReady(db: Db, scene: unknown[]): Promise<AssetId[]> {
	const ids = [...collectAssetIds(scene)];
	if (ids.length === 0) return ids;
	const ready = new Set((await db.asset.findMany({ where: { id: { in: ids }, status: 'ready' }, select: { id: true } })).map((row) => row.id));
	const missing = ids.filter((id) => !ready.has(id));
	if (missing.length) throw new MissingAssetsError(missing);
	return ids;
}

const holderTables = {
	cloudItem: (db: Db, holderId: string, assetIds: string[]) => db.cloudItemAsset.createMany({ data: assetIds.map((assetId) => ({ itemId: holderId, assetId })), skipDuplicates: true }),
	worldInventoryItem: (db: Db, holderId: string, assetIds: string[]) => db.worldInventoryItemAsset.createMany({ data: assetIds.map((assetId) => ({ itemId: holderId, assetId })), skipDuplicates: true }),
	publishedRevision: (db: Db, holderId: string, assetIds: string[]) => db.publishedRevisionAsset.createMany({ data: assetIds.map((assetId) => ({ revisionId: holderId, assetId })), skipDuplicates: true }),
	marketplaceRevision: (db: Db, holderId: string, assetIds: string[]) => db.marketplaceRevisionAsset.createMany({ data: assetIds.map((assetId) => ({ revisionId: holderId, assetId })), skipDuplicates: true }),
	world: (db: Db, holderId: string, assetIds: string[]) => db.worldAsset.createMany({ data: assetIds.map((assetId) => ({ worldId: holderId, assetId })), skipDuplicates: true })
};

async function clearHolder(db: Db, holder: AssetHolder): Promise<string[]> {
	switch (holder.kind) {
		case 'cloudItem': {
			const previous = await db.cloudItemAsset.findMany({ where: { itemId: holder.id }, select: { assetId: true } });
			await db.cloudItemAsset.deleteMany({ where: { itemId: holder.id } });
			return previous.map((row) => row.assetId);
		}
		case 'worldInventoryItem': {
			const previous = await db.worldInventoryItemAsset.findMany({ where: { itemId: holder.id }, select: { assetId: true } });
			await db.worldInventoryItemAsset.deleteMany({ where: { itemId: holder.id } });
			return previous.map((row) => row.assetId);
		}
		case 'publishedRevision': {
			const previous = await db.publishedRevisionAsset.findMany({ where: { revisionId: holder.id }, select: { assetId: true } });
			await db.publishedRevisionAsset.deleteMany({ where: { revisionId: holder.id } });
			return previous.map((row) => row.assetId);
		}
		case 'marketplaceRevision': {
			const previous = await db.marketplaceRevisionAsset.findMany({ where: { revisionId: holder.id }, select: { assetId: true } });
			await db.marketplaceRevisionAsset.deleteMany({ where: { revisionId: holder.id } });
			return previous.map((row) => row.assetId);
		}
		case 'world': {
			const previous = await db.worldAsset.findMany({ where: { worldId: holder.id }, select: { assetId: true } });
			await db.worldAsset.deleteMany({ where: { worldId: holder.id } });
			return previous.map((row) => row.assetId);
		}
	}
}

/**
 * Records that `holder` (an inventory item, a published revision, a hosted
 * world) uses these models, replacing whatever it referenced before. The user
 * is made an owner of any model they did not already own, so what they keep
 * referencing is what they are charged for. Call inside the transaction that saves the scene.
 */
export async function linkSceneAssets(db: Db, user: SessionUser, holder: AssetHolder, assetIds: AssetId[]): Promise<void> {
	const previous = await clearHolder(db, holder);
	if (assetIds.length) {
		const assets = await db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, byteSize: true, manifest: true } });
		for (const asset of assets) await grantOwnership(db, user.id, asset, (asset.manifest as unknown as AssetManifest).name ?? 'Asset', 'clone');
		await holderTables[holder.kind](db, holder.id, assetIds);
		await db.asset.updateMany({ where: { id: { in: assetIds }, orphanedAt: { not: null } }, data: { orphanedAt: null } });
	}
	for (const assetId of previous) if (!assetIds.includes(assetId as AssetId)) await markOrphanIfUnused(db, assetId);
}

/**
 * The preview image of an inventory item, made safe to store and link. `undefined` keeps what the item has, `null` removes it,
 * and an id is used only if it is a finished image asset: a preview that is missing or wrong never fails the save it belongs to.
 */
export async function resolveThumbnail(db: Db, requested: unknown, current: string | null): Promise<AssetId | null> {
	if (requested === undefined) return (current as AssetId | null) ?? null;
	if (requested === null) return null;
	if (!isAssetId(requested)) return (current as AssetId | null) ?? null;
	const asset = await db.asset.findUnique({ where: { id: requested }, select: { status: true, manifest: true } });
	const ready = asset?.status === 'ready' && (asset.manifest as unknown as AssetManifest).type === 'image';
	return ready ? requested : ((current as AssetId | null) ?? null);
}

/** The ids to link for an item: what its scene uses, plus its preview image. */
export const withThumbnail = (sceneIds: AssetId[], thumbnail: AssetId | null): AssetId[] => (thumbnail && !sceneIds.includes(thumbnail) ? [...sceneIds, thumbnail] : sceneIds);

/** Hosting a session only links models that are already in the cloud; the rest travel peer to peer. */
export async function readyAssetIds(db: Db, scene: unknown[]): Promise<AssetId[]> {
	const ids = [...collectAssetIds(scene)];
	if (ids.length === 0) return ids;
	const rows = await db.asset.findMany({ where: { id: { in: ids }, status: 'ready' }, select: { id: true } });
	return rows.map((row) => row.id as AssetId);
}

/** For consumers of a published world: sizes and bounds of its models so placeholders are right before any download. */
export async function assetSummaries(db: Db, ids: AssetId[]): Promise<AssetSummary[]> {
	if (ids.length === 0) return [];
	const rows = await db.asset.findMany({ where: { id: { in: ids }, status: 'ready' }, select: { id: true, byteSize: true, manifest: true } });
	return rows.map((row) => summarizeManifest(row.manifest as unknown as AssetManifest));
}
