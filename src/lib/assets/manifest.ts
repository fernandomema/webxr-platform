import type { Vec3 } from '../ecs/types';
import { getAssetKind } from './kinds/index.ts';
import type { AssetId } from './ref';

export { ASSET_LIMITS } from './limits.ts';

/** Fields every kind of asset has. What else a manifest carries is up to its kind (`kinds/`). */
export interface AssetManifestBase {
	assetId: AssetId;
	/** The kind of asset; selects the entry in the kind registry. Named `type` so manifests stored before kinds existed stay valid. */
	type: string;
	format: string;
	mimeType: string;
	byteSize: number;
	name: string;
}

/** What is known about a model without loading it. Computed at import and stored beside the bytes. */
export interface ModelManifest extends AssetManifestBase {
	type: 'model';
	format: 'glb';
	mimeType: 'model/gltf-binary';
	/** Axis-aligned bounds of the model in its own units, before normalisation. */
	bounds: { min: Vec3; max: Vec3 };
	triangles: number;
	meshes: number;
	materials: number;
	textures: number;
}

export interface AudioManifest extends AssetManifestBase {
	type: 'audio';
	format: 'mp3' | 'wav' | 'ogg';
	/** Seconds. Measured from the file's headers, so approximate for variable-bitrate MP3. */
	duration: number;
	channels: number;
	sampleRate: number;
}

/** Add a kind's manifest here when registering a new kind. */
export type AssetManifest = ModelManifest | AudioManifest;
export type AssetType = AssetManifest['type'];

/** Where a peer can get the bytes from: the cloud, or (only) the host of the current session. */
export type AssetAvailability = 'cloud' | 'host';

/** The small description shipped in snapshots and world packages so placeholders can be sized before any download. */
export interface AssetSummary {
	assetId: AssetId;
	byteSize: number;
	availability: AssetAvailability;
	type?: AssetType;
	/** Models only. */
	bounds?: { min: Vec3; max: Vec3 };
	/** Audio only, in seconds. */
	duration?: number;
}

const HEX_ID = /^sha256:[0-9a-f]{64}$/;

/**
 * Checks a manifest received from a client before the server records it. The
 * server never trusts sizes it did not measure itself: `byteSize` is checked
 * against the stored object when the upload completes.
 */
export function validateManifest(value: unknown): AssetManifest {
	const m = value as Partial<AssetManifestBase> | null;
	if (!m || typeof m !== 'object') throw new Error('Invalid asset manifest');
	if (typeof m.assetId !== 'string' || !HEX_ID.test(m.assetId)) throw new Error('Invalid asset id');
	const kind = typeof m.type === 'string' ? getAssetKind(m.type) : undefined;
	if (!kind) throw new Error('Unsupported asset type');
	const format = kind.formats.find((entry) => entry.format === m.format);
	if (!format || m.mimeType !== format.mimeType) throw new Error(`Unsupported ${kind.type} format`);
	if (!Number.isInteger(m.byteSize) || (m.byteSize as number) <= 0) throw new Error('Invalid asset size');
	if ((m.byteSize as number) > kind.maxBytes) throw new Error('The asset is too large');
	if (typeof m.name !== 'string' || m.name.length === 0 || m.name.length > 120) throw new Error('Invalid asset name');
	kind.validate(m);
	return m as AssetManifest;
}

/** The summary of a manifest, for worlds and snapshots. */
export function summarizeManifest(manifest: AssetManifest, availability: AssetAvailability = 'cloud'): AssetSummary {
	const base: AssetSummary = { assetId: manifest.assetId, byteSize: manifest.byteSize, availability, type: manifest.type };
	return { ...base, ...getAssetKind(manifest.type)?.summary?.(manifest) };
}
