import { isAssetId } from '$lib/assets/ref';
import type { AssetManifest } from '$lib/assets/manifest';
import { prisma } from '../db';
import { BadRequestError, UnauthorizedError } from '../errors';
import { releaseOwnership } from './assets';
import type { SessionUser } from './worlds';

/**
 * Sets (or with `null` clears) the profile picture. The picture is an image asset the caller already uploaded and owns, so
 * it counts against their storage like any other asset. `user.image` may also hold an external URL (a Discord avatar);
 * only asset ids are ever released here.
 */
export async function setProfileAvatar(user: SessionUser | null, requested: unknown): Promise<{ image: string | null }> {
	if (!user) throw new UnauthorizedError();
	if (requested !== null && !isAssetId(requested)) throw new BadRequestError('Invalid image');
	if (requested) {
		const owned = await prisma.assetOwner.findUnique({ where: { assetId_ownerId: { assetId: requested, ownerId: user.id } }, select: { asset: { select: { status: true, manifest: true } } } });
		const ready = owned?.asset.status === 'ready' && (owned.asset.manifest as unknown as AssetManifest).type === 'image';
		if (!ready) throw new BadRequestError('Upload the image first.');
	}
	const previous = (await prisma.user.findUnique({ where: { id: user.id }, select: { image: true } }))?.image ?? null;
	await prisma.user.update({ where: { id: user.id }, data: { image: requested } });
	if (previous && previous !== requested && isAssetId(previous)) {
		// The old picture no longer needs to occupy storage, unless something of theirs still uses it.
		await releaseOwnership(user, previous).catch((error) => {
			if (!(error instanceof BadRequestError)) throw error;
		});
	}
	return { image: requested };
}
