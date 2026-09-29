import { isAssetId, type AssetId } from './ref.ts';

/** Lowercase hex SHA-256. Needs a secure context in browsers (the dev server and Quest both use https). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The content address of some bytes. */
export async function assetIdOf(bytes: Uint8Array): Promise<AssetId> {
	const id = `sha256:${await sha256Hex(bytes)}`;
	if (!isAssetId(id)) throw new Error('Could not compute the asset hash');
	return id;
}
